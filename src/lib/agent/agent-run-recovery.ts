/**
 * 中断した実行の確認と復旧(サーバー専用)
 *
 * ランナー向けの実行の取得(`GET /api/agent/runs` / `GET /api/agent/runs/:id`)と、
 * 承認者がチケット詳細から行う再実行・停止。実行を閉じる処理そのもの(`cancelAgentRun`)は agent-run.ts にある。
 */

import type { Prisma } from '@/generated/prisma/client'
import type { AgentRunStatus } from '@/generated/prisma/enums'
import { assertTicketAccess, type Actor } from '../board/board-access'
import { lockTicketRow } from '../board/row-lock'
import { nowDate } from '../day'
import { errInvalidOperation } from '../error'
import { logger } from '../logger'
import { prisma, type Db } from '../prisma'
import { AGENT_RETRYABLE_STATES, agentStateData } from './agent'
import { cancelAgentRun } from './agent-run'

/** ランナーへ返す実行の項目 */
const agentRunViewSelect = {
  id: true,
  ticketId: true,
  ticketRef: true,
  action: true,
  status: true,
  summary: true,
  requestId: true,
  startedAt: true,
  finishedAt: true,
} as const satisfies Prisma.AgentRunSelect

export type AgentRunView = Prisma.AgentRunGetPayload<{ select: typeof agentRunViewSelect }>

/** 実行の一覧で一度に返す件数の既定値と上限 */
export const AGENT_RUN_LIST_DEFAULT_LIMIT = 20
export const AGENT_RUN_LIST_MAX_LIMIT = 100

/** ランナー自身の実行の一覧(開始の新しい順) */
export const listRunnerAgentRuns = async (
  runnerId: string,
  filter: { status?: AgentRunStatus; ticketId?: string; requestId?: string; limit?: number },
): Promise<AgentRunView[]> =>
  prisma.agentRun.findMany({
    where: {
      runnerId,
      ...(filter.status && { status: filter.status }),
      ...(filter.ticketId && { ticketId: filter.ticketId }),
      ...(filter.requestId && { requestId: filter.requestId }),
    },
    orderBy: { startedAt: 'desc' },
    take: filter.limit ?? AGENT_RUN_LIST_DEFAULT_LIMIT,
    select: agentRunViewSelect,
  })

/** ランナー自身の実行 1 件。他のランナーの実行は null */
export const findRunnerAgentRun = async (runnerId: string, runId: string): Promise<AgentRunView | null> =>
  prisma.agentRun.findFirst({ where: { id: runId, runnerId }, select: agentRunViewSelect })

/**
 * チケットの実行中の実行。停止ボタンを出すか・再実行できるかの判定と、`get_agent_task` の `task.runId` に使う。
 * `runnerId` を指定するとそのランナーの実行に限る。
 */
export const findRunningAgentRunId = async (
  ticketId: string,
  runnerId?: string,
  tx: Db = prisma,
): Promise<string | null> => {
  const run = await tx.agentRun.findFirst({
    where: { ticketId, status: 'running', ...(runnerId && { runnerId }) },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  })
  return run?.id ?? null
}

/** 承認者の操作の共通の確認。担当がエージェントでなければ操作の意味が無い */
const assertAgentOperator = async (actor: Actor, ticketId: string, tx: Db) => {
  const access = await assertTicketAccess(actor, ticketId, 'agentMode', tx)
  if (!access.assigneeIsAgent) {
    throw errInvalidOperation()
  }
  return access
}

/**
 * 失敗・見送りのチケットを処理待ちへ戻す(承認者のみ)。実行中の実行が残っている間は戻せない。
 *
 * 直近の実行が revise なら `planned` へ戻す。`agentStateAt` は実行の開始・失敗では動かない(`agentStateData`)ので、
 * 返答待ちに入った時刻のまま残っており、元の返信・返答で revise として拾い直せる。
 * その実行が引き受けた自動差し戻しのきっかけも未消化へ戻す。それ以外は `queued` へ戻し、処理方式に応じて最初からやり直す。
 */
export const retryAgentTicket = async (actor: Actor, ticketId: string, now: Date = nowDate()) => {
  const state = await prisma.$transaction(async (tx) => {
    const access = await assertAgentOperator(actor, ticketId, tx)
    // ランナーの実行開始と直列にする(開始と同時に戻すと、実行中なのに処理待ちになる)
    await lockTicketRow(tx, ticketId)
    const ticket = await tx.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      select: { agentMode: true, agentState: true, agentStateAt: true },
    })
    if (!ticket.agentMode || !ticket.agentState || !AGENT_RETRYABLE_STATES.has(ticket.agentState)) {
      throw errInvalidOperation()
    }
    if (await findRunningAgentRunId(ticketId, undefined, tx)) {
      throw errInvalidOperation()
    }

    const latest = await tx.agentRun.findFirst({
      where: { ticketId, runner: { userId: access.assigneeId ?? undefined } },
      orderBy: { startedAt: 'desc' },
      select: { id: true, action: true, startedAt: true },
    })
    if (latest?.action === 'revise') {
      await tx.agentAutoReviseTrigger.updateMany({
        where: { runId: latest.id },
        data: { runId: null, consumed: false },
      })
      // agentStateData を通すと agentStateAt が今になり、返答待ちの間に付いた返信を拾えなくなるので、状態だけを戻す。
      // 導入前から返答待ちだった(時刻の無い)チケットは、その実行の開始時刻を返答待ちの時刻とみなす
      await tx.ticket.update({
        where: { id: ticketId },
        data: { agentState: 'planned', ...(ticket.agentStateAt === null && { agentStateAt: latest.startedAt }) },
      })
      return 'planned' as const
    }
    await tx.ticket.update({ where: { id: ticketId }, data: agentStateData('queued', now) })
    return 'queued' as const
  })

  logger.info({ userId: actor.id, ticketId, state }, 'agent ticket retried')
  return { state }
}

/**
 * チケットの実行中の実行を停止する(承認者のみ)。ランナー側の CLI プロセスは止まらない。
 */
export const cancelAgentTicketRun = async (actor: Actor, ticketId: string) => {
  await assertAgentOperator(actor, ticketId, prisma)
  const runId = await findRunningAgentRunId(ticketId)
  if (!runId || (await cancelAgentRun({ runId, ticketId })) !== 'canceled') {
    throw errInvalidOperation()
  }
  logger.info({ userId: actor.id, ticketId, runId }, 'agent run canceled by user')
  return { runId }
}
