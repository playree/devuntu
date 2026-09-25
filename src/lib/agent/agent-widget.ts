/**
 * ダッシュボードのエージェント系 Widget 用の取得処理(サーバー専用)。
 *
 * 見える範囲は `/agents` と同じく「自分が承認者になっているエージェント」だけ。
 * 承認者でなければ DB のチケット・実行履歴を引かずに空を返す。
 */

import { OPEN_TICKET_STATUSES } from '../board/ticket-enum'
import { ticketDisplayId } from '../board/ticket-id'
import { prisma } from '../prisma'
import { listApprovableAgents } from './agent-approver'

/** 承認待ちの表示件数 */
export const AGENT_APPROVALS_LIMIT = 10

/** 実行状況の表示件数 */
export const AGENT_RUNS_WIDGET_LIMIT = 10

/** エージェント系 Widget をダッシュボードの選択肢に出すか。承認者になっているエージェントが1つでもあれば出す */
export const canUseAgentWidgets = async (userId: string): Promise<boolean> =>
  (await listApprovableAgents(userId)).length > 0

/** 承認待ちの条件。エージェントモード未選択(選択待ち)の未完了チケット。アーカイブ済みボードは承認できないので外す */
const pendingApprovalWhere = (agentIds: string[]) => ({
  assigneeId: { in: agentIds },
  status: { in: OPEN_TICKET_STATUSES },
  agentMode: null,
  board: { archived: false },
})

/** 承認待ちのチケット(優先度 → 更新日の新しい順)と総件数 */
export const listPendingApprovalTickets = async (userId: string) => {
  const agents = await listApprovableAgents(userId)
  if (agents.length === 0) {
    return { items: [], total: 0 }
  }

  const where = pendingApprovalWhere(agents.map((agent) => agent.id))
  const [total, tickets] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      select: {
        id: true,
        number: true,
        title: true,
        priority: true,
        board: { select: { key: true } },
        assignee: { select: { name: true } },
      },
      orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }, { id: 'asc' }],
      take: AGENT_APPROVALS_LIMIT,
    }),
  ])

  return {
    items: tickets.map(({ board, number, assignee, ...ticket }) => ({
      ...ticket,
      displayId: ticketDisplayId({ key: board.key, number }),
      agentName: assignee?.name ?? '',
    })),
    total,
  }
}

/** 承認対象エージェントの最近の実行(新しい順) */
export const listRecentAgentRuns = async (userId: string) => {
  const agents = await listApprovableAgents(userId)
  if (agents.length === 0) {
    return []
  }

  const runs = await prisma.agentRun.findMany({
    where: { runner: { userId: { in: agents.map((agent) => agent.id) } } },
    select: {
      id: true,
      ticketId: true,
      ticketRef: true,
      action: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      runner: { select: { user: { select: { name: true } } } },
    },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: AGENT_RUNS_WIDGET_LIMIT,
  })

  return runs.map(({ runner, ...run }) => ({ ...run, agentName: runner.user.name }))
}
