/**
 * AIエージェントの自動運用(Devuntu Agent)の中核ロジック(サーバー専用)
 *
 * 利用者のマシンで動くランナー(`/api/agent/*`)と、Claude が使う MCP ツール(`mcp-agent.ts`)の
 * 両方から呼ぶ。「いま動いてよいか」「次に処理すべきチケットは何か」「実行の記録」をここに集約し、
 * `Ticket.agentState` の遷移を1箇所だけにする。
 */

import { Prisma } from '@/generated/prisma/client'
import type { AgentRunAction, AgentRunStatus, AgentTaskMode, AgentTaskState } from '@/generated/prisma/enums'
import { OPEN_TICKET_STATUSES, ticketDisplayId } from '../board/task'
import { addDaysDateOnly, minToHHmm, nowDate, toZone, zonedMinutes } from '../day'
import { envu } from '../env-util'
import { logger } from '../logger'
import { MAX_NOTIFY_RECIPIENTS } from '../notify/notify'
import { type AgentRunNotification, enqueueAgentRunFinished } from '../notify/notify-trigger'
import { prisma } from '../prisma'
import { AGENT_UNLIMITED_DAILY_RUNS } from './agent'

type Db = Prisma.TransactionClient | typeof prisma

/**
 * 応答が返らないまま放置された実行を失敗として回収するまでの時間(分)。
 * Claude が落ちてもランナーが `PATCH /api/agent/runs/[id]` を送るが、
 * ランナーごと落ちた場合はこの経路でしか `running` が解けない。
 */
export const AGENT_RUN_TIMEOUT_MIN = 60

/** 時間切れで閉じた実行の要約。ランナーが何も報告せずに消えたことを履歴と通知で示す */
const TIMEOUT_SUMMARY = 'timeout'

/** 稼働できない理由。ランナーとエージェントの双方へそのまま返す */
export type AgentInactiveReason = 'no_runner' | 'disabled' | 'outside_hours' | 'daily_limit'

export type AgentRunnerRow = {
  id: string
  userId: string
  enabled: boolean
  activeFromMin: number | null
  activeToMin: number | null
  timezone: string | null
  pollIntervalSec: number
  rule: string | null
  dailyRunLimit: number
  dailyResetMin: number
  /** エージェントユーザー。実行結果の通知に表示名を載せる */
  user: { name: string }
}

/** `AgentRunner` を引くときの共通 select。呼び出し側で形がずれないようにここへ置く */
export const agentRunnerSelect = {
  id: true,
  userId: true,
  enabled: true,
  activeFromMin: true,
  activeToMin: true,
  timezone: true,
  pollIntervalSec: true,
  rule: true,
  dailyRunLimit: true,
  dailyResetMin: true,
  user: { select: { name: true } },
} as const

export const findAgentRunner = async (userId: string): Promise<AgentRunnerRow | null> =>
  prisma.agentRunner.findUnique({ where: { userId }, select: agentRunnerSelect })

type ActiveWindow = Pick<AgentRunnerRow, 'activeFromMin' | 'activeToMin' | 'timezone'>

/** 時間帯の判定に使うタイムゾーン。ランナーに未設定ならサーバーの既定(`DEFAULT_TIMEZONE`) */
const runnerTimezone = (window: Pick<AgentRunnerRow, 'timezone'>): string =>
  window.timezone ?? envu.server.DEFAULT_TIMEZONE

/**
 * 稼働許可時間帯の内側かどうか。
 *
 * 片方でも未設定、または開始と終了が同じ場合は終日とみなす。
 * 開始 > 終了(例 22:00〜06:00)は日跨ぎとして扱う。終了時刻ちょうどは含めない。
 */
export const isWithinActiveWindow = (window: ActiveWindow, now: Date = nowDate()): boolean => {
  const { activeFromMin: from, activeToMin: to } = window
  if (from === null || to === null || from === to) {
    return true
  }
  const zoned = toZone(now, runnerTimezone(window))
  const current = zoned.hour() * 60 + zoned.minute()
  return from < to ? current >= from && current < to : current >= from || current < to
}

/** 表示用の稼働時間帯。終日の場合は null */
export const activeWindowLabel = (window: ActiveWindow): { from: string; to: string; timezone: string } | null => {
  const { activeFromMin: from, activeToMin: to } = window
  if (from === null || to === null || from === to) {
    return null
  }
  return { from: minToHHmm(from), to: minToHHmm(to), timezone: runnerTimezone(window) }
}

/** 処理上限の消化状況。上限が無制限のときは持たない */
export type AgentRunUsage = { used: number; limit: number; resetAt: Date }

export type AgentActivity = {
  active: boolean
  reason: AgentInactiveReason | null
  usage?: AgentRunUsage | null
}

/** 稼働条件の判定。設定が無い(= 自動運用を使わない)場合も稼働不可として扱う */
export const evaluateRunner = (runner: AgentRunnerRow | null, now: Date = nowDate()): AgentActivity => {
  if (!runner) {
    return { active: false, reason: 'no_runner' }
  }
  if (!runner.enabled) {
    return { active: false, reason: 'disabled' }
  }
  if (!isWithinActiveWindow(runner, now)) {
    return { active: false, reason: 'outside_hours' }
  }
  return { active: true, reason: null }
}

type DailyWindow = Pick<AgentRunnerRow, 'dailyResetMin' | 'timezone'>

/**
 * 処理上限のカウント期間。暦日ではなくリセット時刻を境にする。
 *
 * リセット時刻前は前日ぶんの期間がまだ続いているとみなす。`resetAt` は次にカウントが
 * 0 に戻る時刻で、上限に達したときに「いつ再開するか」を伝えるために返す。
 */
export const dailyRunWindow = (window: DailyWindow, now: Date = nowDate()): { since: Date; resetAt: Date } => {
  const tz = runnerTimezone(window)
  const today = toZone(now, tz).format('YYYY-MM-DD')
  const todayReset = zonedMinutes(today, window.dailyResetMin, tz)
  const startDate = todayReset.valueOf() <= now.getTime() ? today : addDaysDateOnly(today, -1)
  return {
    since: zonedMinutes(startDate, window.dailyResetMin, tz).toDate(),
    resetAt: zonedMinutes(addDaysDateOnly(startDate, 1), window.dailyResetMin, tz).toDate(),
  }
}

/** カウント期間に開始した実行の数。失敗や見送りも起動した以上は数える */
export const countAgentRunsSince = async (db: Db, runnerId: string, since: Date): Promise<number> =>
  db.agentRun.count({ where: { runnerId, startedAt: { gte: since } } })

/** 処理上限の消化状況を算出する。上限チェックと実行作成の両方から使うので共通化している */
const computeAgentRunUsage = async (db: Db, runner: AgentRunnerRow, now: Date): Promise<AgentRunUsage> => {
  const { since, resetAt } = dailyRunWindow(runner, now)
  const used = await countAgentRunsSince(db, runner.id, since)
  return { used, limit: runner.dailyRunLimit, resetAt }
}

/**
 * 稼働条件の判定に1日の処理上限を加えたもの。DB を引くので非同期。
 *
 * 上限が無制限、または他の理由で既に稼働不可なら件数は数えない(ポーリングのたびに引かせない)。
 */
export const evaluateRunnerActivity = async (
  runner: AgentRunnerRow | null,
  now: Date = nowDate(),
): Promise<AgentActivity> => {
  const activity = evaluateRunner(runner, now)
  if (!runner || !activity.active || runner.dailyRunLimit <= AGENT_UNLIMITED_DAILY_RUNS) {
    return activity
  }

  const usage = await computeAgentRunUsage(prisma, runner, now)
  return usage.used >= usage.limit
    ? { active: false, reason: 'daily_limit', usage }
    : { active: true, reason: null, usage }
}

export type AgentTask = {
  ticketId: string
  displayId: string
  title: string
  mode: AgentTaskMode
  action: AgentRunAction
  state: AgentTaskState | null
}

/**
 * プラン投稿後に利用者からの返信が来ているか。
 *
 * エージェント自身の最新コメントより後に、他の誰かのコメントが付いていれば返信とみなす。
 * 投稿者が消えたコメント(`authorId = null`)も利用者側の発言として数える。
 */
const hasReplyAfterPlan = async (ticketId: string, agentUserId: string): Promise<boolean> => {
  const lastAgentComment = await prisma.ticketComment.findFirst({
    where: { ticketId, authorId: agentUserId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  if (!lastAgentComment) {
    return false
  }
  const reply = await prisma.ticketComment.findFirst({
    where: {
      ticketId,
      createdAt: { gt: lastAgentComment.createdAt },
      OR: [{ authorId: { not: agentUserId } }, { authorId: null }],
    },
    select: { id: true },
  })
  return reply !== null
}

/** 待ち行列と名指し取得で形をそろえるための select */
const agentTicketSelect = {
  id: true,
  number: true,
  title: true,
  status: true,
  assigneeId: true,
  agentMode: true,
  agentState: true,
  board: { select: { key: true } },
} as const

type AgentTicketRow = {
  id: string
  number: number
  title: string
  status: string
  assigneeId: string | null
  agentMode: AgentTaskMode | null
  agentState: AgentTaskState | null
  board: { key: string }
}

/**
 * そのチケットで実行すべきアクション。処理する必要が無い場合は null。
 *
 * 処理中(`running`)のものは、開始時に記録したアクションをそのまま返す。ランナーが実行を
 * 開始してから Claude が問い合わせる順序になるため、ここを落とすと自分の作業を見失う。
 */
const deriveAction = async (
  runner: AgentRunnerRow,
  ticket: AgentTicketRow,
  mode: AgentTaskMode,
): Promise<AgentRunAction | null> => {
  const initial: AgentRunAction = mode === 'plan' ? 'plan' : 'execute'

  if (ticket.agentState === 'running') {
    const open = await prisma.agentRun.findFirst({
      where: { runnerId: runner.id, ticketId: ticket.id, status: 'running' },
      orderBy: { startedAt: 'desc' },
      select: { action: true },
    })
    return open?.action ?? initial
  }

  if (ticket.agentState === 'planned') {
    // 返信が来るまでは待つ。返信の内容にどう従うかは Claude 側の判断
    return (await hasReplyAfterPlan(ticket.id, runner.userId)) ? 'revise' : null
  }

  return initial
}

const toAgentTask = (ticket: AgentTicketRow, mode: AgentTaskMode, action: AgentRunAction): AgentTask => ({
  ticketId: ticket.id,
  displayId: ticketDisplayId({ key: ticket.board.key, number: ticket.number }),
  title: ticket.title,
  mode,
  action,
  state: ticket.agentState,
})

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
} as const

type AgentRunNotifyTicket = {
  id: string
  boardId: string
  number: number
  title: string
  board: { key: string }
}

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

/**
 * エージェントが処理してよいチケットの条件。待ち行列・名指し・開始時の確認で共通に使う。
 *
 * 「担当がこのエージェント」かつ「`agentMode` が指定済み(オプトイン)」かつ「未完了」に加えて、
 * ボードが未アーカイブで、エージェント自身がそのボードのメンバー(直接 / グループ経由)であること。
 * 担当のまま外されたボードやアーカイブ済みのボードでは、エージェントはチケットを読み書きできない。
 */
const agentWorkableTicketWhere = (userId: string): Prisma.TicketWhereInput => ({
  assigneeId: userId,
  agentMode: { not: null },
  status: { in: [...OPEN_TICKET_STATUSES] },
  board: {
    archived: false,
    OR: [{ members: { some: { userId } } }, { groups: { some: { group: { userGroups: { some: { userId } } } } } }],
  },
})

/**
 * 処理すべきチケットの一覧。
 *
 * `running` は処理中なので拾わない(時間切れ分は `failStaleAgentRuns` が先に解除している)。
 */
export const pickAgentTasks = async (runner: AgentRunnerRow): Promise<AgentTask[]> => {
  const tickets = await prisma.ticket.findMany({
    where: {
      ...agentWorkableTicketWhere(runner.userId),
      OR: [{ agentState: null }, { agentState: { in: ['queued', 'planned'] } }],
    },
    select: agentTicketSelect,
    orderBy: [{ priority: 'asc' }, { updatedAt: 'asc' }],
  })

  const tasks: AgentTask[] = []
  for (const ticket of tickets) {
    if (ticket.agentMode === null) {
      continue
    }
    const action = await deriveAction(runner, ticket, ticket.agentMode)
    if (action) {
      tasks.push(toAgentTask(ticket, ticket.agentMode, action))
    }
  }
  return tasks
}

/**
 * チケット1件を名指しで引く。
 *
 * ランナーは Claude を起動する前に実行を開始する(= チケットは `running`)ので、Claude が
 * `get_agent_task` で自分の担当を確かめるときは待ち行列に載っていない。
 * 待ち行列(`pickAgentTasks`)とは別に、処理中のものも解決できる経路を用意する。
 */
export const resolveAgentTask = async (runner: AgentRunnerRow, ticketId: string): Promise<AgentTask | null> => {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, ...agentWorkableTicketWhere(runner.userId) },
    select: agentTicketSelect,
  })
  if (!ticket || ticket.agentMode === null) {
    return null
  }

  const action = await deriveAction(runner, ticket, ticket.agentMode)
  return action ? toAgentTask(ticket, ticket.agentMode, action) : null
}

/** 対象チケット1件分の情報。実行の開始・終了で共通に使う */
export type AgentTicket = { id: string; displayId: string; mode: AgentTaskMode; state: AgentTaskState | null }

/** エージェントが処理してよいチケットかを確かめる。条件は `agentWorkableTicketWhere` */
export const findAgentTicket = async (userId: string, ticketId: string): Promise<AgentTicket | null> => {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, ...agentWorkableTicketWhere(userId) },
    select: agentTicketSelect,
  })
  if (!ticket || ticket.agentMode === null) {
    return null
  }
  return {
    id: ticket.id,
    displayId: ticketDisplayId({ key: ticket.board.key, number: ticket.number }),
    mode: ticket.agentMode,
    state: ticket.agentState,
  }
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
