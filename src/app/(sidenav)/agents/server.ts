'use server'

import type { TicketWhereInput } from '@/generated/prisma/models'
import { safeAuthAction } from '@/lib/action/action-server'
import { agentStateWhere } from '@/lib/agent/agent'
import { isAgentApprover, listApprovableAgents } from '@/lib/agent/agent-approver'
import { createAgentRunnerActions } from '@/lib/agent/agent-runner-action'
import { OPEN_TICKET_STATUSES } from '@/lib/board/ticket-enum'
import { ticketDisplayId } from '@/lib/board/ticket-id'
import { ticketListOrderBy } from '@/lib/board/ticket-search'
import { errInvalidOperation } from '@/lib/error'
import { prisma } from '@/lib/prisma'
import { scAgentTicketListQuery } from '@/lib/schema/schema-agent'

/**
 * 承認者以外を弾く。
 * `isAgentApprover` は対象が `isAgent` でなければ常に false を返すため、
 * エージェント以外の ID を渡された場合もここで落ちる。
 */
const assertApprover = async (userId: string, agentId: string) => {
  if (!(await isAgentApprover(userId, agentId))) {
    throw errInvalidOperation()
  }
}

/**
 * 承認対象のエージェント一覧。
 *
 * 承認者に設定されていなければ空になり、画面はその旨だけを表示する。
 */
export const getApprovableAgents = safeAuthAction
  .metadata({ actionName: 'getApprovableAgents', role: 'user' })
  .action(async ({ ctx: { user } }) => await listApprovableAgents(user.id))
export type GetApprovableAgentsReturnType = Awaited<ReturnType<typeof getApprovableAgents>>['data']

/**
 * 選択したエージェントが担当のチケット一覧(ページング)
 *
 * 承認者はボードのメンバーとは限らないため、可視スコープはボードではなく
 * 「そのエージェントの承認者かどうか」で決める。
 */
export const getAgentTickets = safeAuthAction
  .metadata({ actionName: 'getAgentTickets', role: 'user' })
  .inputSchema(scAgentTicketListQuery)
  .action(
    async ({ ctx: { user }, parsedInput: { agentId, agentState, page, rowsPerPage, sortColumn, sortDirection } }) => {
      await assertApprover(user.id, agentId)

      const where: TicketWhereInput = {
        assigneeId: agentId,
        // 完了したチケットは承認する余地が無いので、絞り込みの指定によらず常に外す
        status: { in: OPEN_TICKET_STATUSES },
        ...agentStateWhere(agentState),
      }
      const [total, tickets] = await Promise.all([
        prisma.ticket.count({ where }),
        prisma.ticket.findMany({
          where,
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            priority: true,
            dueDate: true,
            board: { select: { name: true, kind: true, key: true, archived: true } },
            agentMode: true,
            agentState: true,
            updatedAt: true,
          },
          orderBy: ticketListOrderBy(sortColumn, sortDirection),
          skip: (page - 1) * rowsPerPage,
          take: rowsPerPage,
        }),
      ])

      return {
        items: tickets.map(({ board, ...ticket }) => ({
          ...ticket,
          displayId: ticketDisplayId({ key: board.key, number: ticket.number }),
          boardName: board.name,
          boardKind: board.kind,
          // アーカイブ済みボードのチケットは承認者でも変更できない(canEditAgentMode と同じ判定)
          canEditAgentMode: !board.archived,
        })),
        total,
      }
    },
  )
export type GetAgentTicketsReturnType = Awaited<ReturnType<typeof getAgentTickets>>['data']

/**
 * 自動運用の設定・カスタム指示・実行履歴。
 *
 * エージェント管理(管理者向け)と同じ内容を承認者にも開放する。実装は
 * `createAgentRunnerActions` で共有し、ここでは承認者かどうかだけを見る。
 */
const runnerActions = createAgentRunnerActions({
  role: 'user',
  names: {
    get: 'getApprovableAgentRunner',
    save: 'saveApprovableAgentRunner',
    saveRule: 'saveApprovableAgentRunnerRule',
    runs: 'getApprovableAgentRuns',
  },
  authorize: async (user, agentId) => await assertApprover(user.id, agentId),
})
export const getApprovableAgentRunner = runnerActions.getAgentRunner
export const saveApprovableAgentRunner = runnerActions.saveAgentRunner
export const saveApprovableAgentRunnerRule = runnerActions.saveAgentRunnerRule
export const getApprovableAgentRuns = runnerActions.getAgentRuns
