/**
 * エージェントの実行の開始・終了の記録と、実行結果の通知(サーバー専用)
 *
 * 実行を閉じる経路は 3 つ(時間切れ / ランナーの終了報告 / エージェント自身の結果報告)で、
 * いずれも `status: 'running'` の条件付き更新で掴めたときだけ通知する。
 */

import { Prisma } from '@/generated/prisma/client'
import type { AgentRunAction, AgentRunStatus, AgentTaskState } from '@/generated/prisma/enums'
import { ticketDisplayId } from '../board/ticket-id'
import { nowDate } from '../day'
import { logger } from '../logger'
import { MAX_NOTIFY_RECIPIENTS } from '../notify/notify'
import { type AgentRunNotification, enqueueAgentRunFinished } from '../notify/notify-trigger'
import { prisma } from '../prisma'
import { AGENT_UNLIMITED_DAILY_RUNS } from './agent'
import { type AgentRunUsage, computeAgentRunUsage } from './agent-activity'
import type { AgentRunnerRow } from './agent-runner'
import { findAgentTicket } from './agent-task'

/**
 * 応答が返らないまま放置された実行を失敗として回収するまでの時間(分)。
 * Claude が落ちてもランナーが `PATCH /api/agent/runs/[id]` を送るが、
 * ランナーごと落ちた場合はこの経路でしか `running` が解けない。
 */
export const AGENT_RUN_TIMEOUT_MIN = 60

/** 時間切れで閉じた実行の要約。ランナーが何も報告せずに消えたことを履歴と通知で示す */
const TIMEOUT_SUMMARY = 'timeout'

/**
 * 実行結果の通知に要るチケットの項目。宛先(ボードのチャンネル)もここから引く。
 * 実行を閉じる 3 経路で形がずれないよう共通化する。
 */
const agentRunNotifySelect = {
  id: true,
  boardId: true,
  number: true,
  title: true,
  board: { select: { key: true } },
} as const satisfies Prisma.TicketSelect

type AgentRunNotifyTicket = Prisma.TicketGetPayload<{ select: typeof agentRunNotifySelect }>

/**
 * 閉じた実行から通知の内容を組み立てる。
 *
 * チケットが削除済み(ticket が null)の実行は宛先のボードを辿れないので通知しない。
 * 送るかどうかの最終判断(通知設定 / ボードの通知先 / Slack 無効)は配信側に任せる。
 */
const buildAgentRunNotification = (param: {
  runId: string
  agentName: string
  ticket: AgentRunNotifyTicket | null
  action: AgentRunAction
  status: Exclude<AgentRunStatus, 'running'>
  summary: string | null
  startedAt: Date
  finishedAt: Date
}): AgentRunNotification | null => {
  const { ticket, ...rest } = param
  if (!ticket) {
    return null
  }
  return {
    ...rest,
    ticket: {
      id: ticket.id,
      boardId: ticket.boardId,
      displayId: ticketDisplayId({ key: ticket.board.key, number: ticket.number }),
      title: ticket.title,
    },
  }
}

/**
 * 応答が返らないまま時間切れになった実行を失敗として閉じる。
 * チケットが `running` のまま残ると二度と拾えなくなるので、ポーリングのたびに掃除する。
 */
export const failStaleAgentRuns = async (runnerId: string, now: Date = nowDate()): Promise<number> => {
  const deadline = new Date(now.getTime() - AGENT_RUN_TIMEOUT_MIN * 60 * 1000)
  const stale = await prisma.agentRun.findMany({
    where: { runnerId, status: 'running', startedAt: { lt: deadline } },
    select: {
      id: true,
      ticketId: true,
      action: true,
      startedAt: true,
      ticket: { select: agentRunNotifySelect },
      runner: { select: { user: { select: { name: true } } } },
    },
  })
  if (stale.length === 0) {
    return 0
  }

  // 掴めた実行だけを対象にする。読み出しから更新までの間に別経路が閉じた実行は、
  // 向こうが確定させた結果と通知を持っているのでこちらは触らない
  const claimed = await prisma.$transaction(async (tx) => {
    const closed: typeof stale = []
    for (const run of stale) {
      const { count } = await tx.agentRun.updateMany({
        where: { id: run.id, status: 'running' },
        data: { status: 'failed', finishedAt: now, summary: TIMEOUT_SUMMARY },
      })
      if (count > 0) {
        closed.push(run)
      }
    }

    const ticketIds = closed.map((run) => run.ticketId).filter((id): id is string => id !== null)
    if (ticketIds.length > 0) {
      await tx.ticket.updateMany({
        where: { id: { in: ticketIds }, agentState: 'running' },
        data: { agentState: 'failed' },
      })
    }

    // まとめて時間切れになった場合に Slack を叩き続けないよう頭打ちにする
    const notifyTo = closed.slice(0, MAX_NOTIFY_RECIPIENTS)
    if (closed.length > notifyTo.length) {
      logger.warn({ runnerId, total: closed.length, notified: notifyTo.length }, 'agent run notify truncated')
    }
    // 実行を閉じるのと同じトランザクションで投入する(コミット後に落ちると通知だけが消える)
    for (const run of notifyTo) {
      const notification = buildAgentRunNotification({
        runId: run.id,
        agentName: run.runner.user.name,
        ticket: run.ticket,
        action: run.action,
        status: 'failed',
        summary: TIMEOUT_SUMMARY,
        startedAt: run.startedAt,
        finishedAt: now,
      })
      if (notification) {
        await enqueueAgentRunFinished(notification, tx)
      }
    }

    return closed
  })
  if (claimed.length === 0) {
    return 0
  }

  logger.warn({ runnerId, count: claimed.length }, 'agent runs timed out')
  return claimed.length
}

export type StartAgentRunResult =
  | { ok: true; run: { id: string; displayId: string } }
  | { ok: false; reason: 'ticket_not_available' }
  | { ok: false; reason: 'daily_limit'; usage: AgentRunUsage }

/**
 * 実行の開始を記録し、チケットを処理中にする。
 * 対象がエージェントの担当でない、またはオプトインされていない場合は `ticket_not_available` を返す。
 *
 * 上限チェックと実行作成を同一トランザクション内で行い、対象ランナーの行をロックすることで、
 * 並行リクエストが上限チェックを両方すり抜けて `dailyRunLimit` を超過するのを防ぐ。
 */
export const startAgentRun = async (
  runner: AgentRunnerRow,
  ticketId: string,
  action: AgentRunAction,
  now: Date = nowDate(),
): Promise<StartAgentRunResult> => {
  const target = await findAgentTicket(runner.userId, ticketId)
  if (!target) {
    return { ok: false, reason: 'ticket_not_available' }
  }

  return prisma.$transaction(async (tx) => {
    if (runner.dailyRunLimit > AGENT_UNLIMITED_DAILY_RUNS) {
      await tx.$queryRaw`SELECT "id" FROM "agent_runner" WHERE "id" = ${runner.id} FOR UPDATE`
      const usage = await computeAgentRunUsage(tx, runner, now)
      if (usage.used >= usage.limit) {
        return { ok: false, reason: 'daily_limit', usage }
      }
    }

    const created = await tx.agentRun.create({
      data: { runnerId: runner.id, ticketId: target.id, ticketRef: target.displayId, action },
      select: { id: true },
    })
    await tx.ticket.update({ where: { id: target.id }, data: { agentState: 'running' } })

    logger.info({ runnerId: runner.id, runId: created.id, ticketRef: target.displayId, action }, 'agent run started')
    return { ok: true, run: { id: created.id, displayId: target.displayId } }
  })
}

/**
 * ランナーからの終了報告。Claude が `finish_agent_task` を呼ばずに落ちた場合の保険も兼ねる。
 *
 * エージェントが結果を報告していれば実行は既に閉じているので、ここで開いたままなのは
 * 報告が無かった場合だけ。ランナーは Claude の終了コードしか知らず、終了コード 0 でも
 * 何をしたかは分からないため、その場合は成功と伝えられても失敗として閉じる。
 *
 * 報告とプロセス終了は数百ms差で連続するため、読み出した時点の status では判断できない。
 * `status: 'running'` の条件付き更新で閉じられたときだけ、こちらが閉じた実行として扱う。
 */
export const finishAgentRunById = async (
  runnerId: string,
  runId: string,
  status: Exclude<AgentRunStatus, 'running'>,
  summary?: string | null,
): Promise<boolean> => {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      runnerId: true,
      status: true,
      ticketId: true,
      action: true,
      startedAt: true,
      ticket: { select: agentRunNotifySelect },
      runner: { select: { user: { select: { name: true } } } },
    },
  })
  if (!run || run.runnerId !== runnerId) {
    return false
  }

  const now = nowDate()
  // 終了コード 0 でも報告が無ければ何をしたか分からないので、成功と伝えられても失敗として閉じる
  const finalStatus = run.status === 'running' && status === 'succeeded' ? 'failed' : status

  const unreported = await prisma.$transaction(async (tx) => {
    const { count } = await tx.agentRun.updateMany({
      where: { id: run.id, status: 'running' },
      data: { status: finalStatus, summary: summary ?? undefined, finishedAt: now },
    })
    if (run.ticketId) {
      // エージェントが結果を報告済みならその状態を尊重し、running のままの場合だけ失敗にする
      await tx.ticket.updateMany({
        where: { id: run.ticketId, agentState: 'running' },
        data: { agentState: 'failed' },
      })
    }

    // 報告済みの実行はここでは閉じていない(finishAgentTask が既に通知している)ので二重に送らない
    const notification =
      count > 0
        ? buildAgentRunNotification({
            runId: run.id,
            agentName: run.runner.user.name,
            ticket: run.ticket,
            action: run.action,
            status: finalStatus,
            summary: summary ?? null,
            startedAt: run.startedAt,
            finishedAt: now,
          })
        : null
    // 実行を閉じるのと同じトランザクションで投入する(コミット後に落ちると通知だけが消える)
    if (notification) {
      await enqueueAgentRunFinished(notification, tx)
    }

    return count > 0
  })

  logger.info({ runnerId, runId, status: finalStatus, unreported }, 'agent run finished')
  return true
}

/** エージェントが報告する処理結果 */
export const AGENT_OUTCOMES = ['planned', 'completed', 'skipped', 'failed'] as const
export type AgentOutcome = (typeof AGENT_OUTCOMES)[number]

const OUTCOME_MAP: Record<AgentOutcome, { state: AgentTaskState; run: Exclude<AgentRunStatus, 'running'> }> = {
  planned: { state: 'planned', run: 'succeeded' },
  completed: { state: 'done', run: 'succeeded' },
  skipped: { state: 'skipped', run: 'skipped' },
  failed: { state: 'failed', run: 'failed' },
}

/**
 * 実行に記録するアクション。
 *
 * `revise` はプラン修正と実装への移行の両方を含み、開始時点ではどちらか決まらない。
 * 完了報告で閉じるときだけ、実際に行った処理へ寄せる。変更が不要なら undefined を返す。
 */
const settleAction = (action: AgentRunAction, outcome: AgentOutcome): AgentRunAction | undefined =>
  action === 'revise' && outcome === 'completed' ? 'execute' : undefined

/**
 * エージェント自身による結果の報告。チケットの状態と、開始済みの実行の両方を閉じる。
 * ランナーを介さず MCP だけで動かした場合は実行の行が無いので、その場合は状態だけ更新する。
 *
 * 実行を閉じるのは `status: 'running'` の条件付き更新で、掴めたときだけチケットの状態を進める。
 * 時間切れ(`failStaleAgentRuns`)などが先に閉じていた場合は、向こうが確定させた状態を尊重して
 * 報告どおりの状態へ巻き戻さず、通知も送らない(向こうが既に送っている)。
 */
export const finishAgentTask = async (
  runner: AgentRunnerRow | null,
  ticketId: string,
  outcome: AgentOutcome,
  summary?: string | null,
): Promise<{ state: AgentTaskState }> => {
  const { state, run } = OUTCOME_MAP[outcome]
  const now = nowDate()

  const result = await prisma.$transaction(async (tx) => {
    // 自動運用の設定が無い(ランナーを介さず MCP だけで動かした)場合は閉じる実行が無い
    const open = runner
      ? await tx.agentRun.findFirst({
          where: { runnerId: runner.id, ticketId, status: 'running' },
          orderBy: { startedAt: 'desc' },
          select: { id: true, action: true, startedAt: true },
        })
      : null
    if (!open || !runner) {
      // 実行履歴が無いので通知もしない。チケットが無ければここで例外になる
      await tx.ticket.update({ where: { id: ticketId }, data: { agentState: state }, select: { id: true } })
      return { state }
    }

    const settled = settleAction(open.action, outcome)
    const { count } = await tx.agentRun.updateMany({
      where: { id: open.id, status: 'running' },
      data: {
        status: run,
        summary: summary ?? undefined,
        finishedAt: now,
        action: settled,
      },
    })
    if (count === 0) {
      const current = await tx.ticket.findUnique({ where: { id: ticketId }, select: { agentState: true } })
      return { state: current?.agentState ?? state }
    }

    const ticket = await tx.ticket.update({
      where: { id: ticketId },
      data: { agentState: state },
      select: agentRunNotifySelect,
    })

    const notification = buildAgentRunNotification({
      runId: open.id,
      agentName: runner.user.name,
      ticket,
      // 実際に記録した処理へ寄せる(revise のまま通知すると履歴と食い違う)
      action: settled ?? open.action,
      status: run,
      summary: summary ?? null,
      startedAt: open.startedAt,
      finishedAt: now,
    })
    // 実行を閉じるのと同じトランザクションで投入する(コミット後に落ちると通知だけが消える)
    if (notification) {
      await enqueueAgentRunFinished(notification, tx)
    }

    return { state }
  })

  logger.info({ runnerId: runner?.id ?? null, ticketId, outcome, state: result.state }, 'agent task finished')
  return { state: result.state }
}
