'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { isAgentApprover, listApprovableAgents } from '@/lib/agent/agent-approver'
import { ticketDisplayId, ticketListOrderBy } from '@/lib/board/task'
import { errInvalidOperation } from '@/lib/error'
import { prisma } from '@/lib/prisma'
import { scAgentTicketListQuery } from '@/lib/schema/schema'

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
  .action(async ({ ctx: { user }, parsedInput: { agentId, page, rowsPerPage, sortColumn, sortDirection } }) => {
    if (!(await isAgentApprover(user.id, agentId))) {
      throw errInvalidOperation()
    }

    const where = { assigneeId: agentId }
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
  })
export type GetAgentTicketsReturnType = Awaited<ReturnType<typeof getAgentTickets>>['data']
