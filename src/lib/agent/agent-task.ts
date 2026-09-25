/**
 * エージェントが処理すべきチケットの選定(サーバー専用)
 */

import { Prisma } from '@/generated/prisma/client'
import type { AgentRunAction, AgentTaskMode, AgentTaskState } from '@/generated/prisma/enums'
import { OPEN_TICKET_STATUSES } from '../board/ticket-enum'
import { ticketDisplayId } from '../board/ticket-id'
import { boardVisibleWhere } from '../board/ticket-permission'
import { prisma } from '../prisma'
import type { AgentRunnerRow } from './agent-runner'

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
} as const satisfies Prisma.TicketSelect

type AgentTicketRow = Prisma.TicketGetPayload<{ select: typeof agentTicketSelect }>

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
    ...boardVisibleWhere(userId),
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
