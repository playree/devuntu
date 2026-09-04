'use server'

import type { TicketWhereInput } from '@/generated/prisma/models'
import { safeAuthAction } from '@/lib/action/action-server'
import { agentStateWhere } from '@/lib/agent/agent'
import { isAgentApprover, listApprovableAgents } from '@/lib/agent/agent-approver'
import {
  findAgentRunnerConfig,
  listAgentRuns,
  saveAgentRunnerConfig,
  saveAgentRunnerRuleValue,
} from '@/lib/agent/agent-runner-config'
import { OPEN_TICKET_STATUSES, ticketDisplayId, ticketListOrderBy } from '@/lib/board/task'
import { errInvalidOperation } from '@/lib/error'
import { prisma } from '@/lib/prisma'
import { scAgentTicketListQuery, scSaveAgentRunner, scSaveAgentRunnerRule, scUUID } from '@/lib/schema/schema'

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
 * エージェント管理(管理者向け)と同じ内容を承認者にも開放する。DB 操作は
 * `@/lib/agent/agent-runner-config` に集約し、ここでは承認者かどうかだけを見る。
 */

/** 自動運用の設定取得。行が無ければ null(= 未設定) */
export const getAgentRunner = safeAuthAction
  .metadata({ actionName: 'getApprovableAgentRunner', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await assertApprover(user.id, id)

    return await findAgentRunnerConfig(id)
  })

/** 自動運用の設定保存(無ければ作成) */
export const saveAgentRunner = safeAuthAction
  .metadata({ actionName: 'saveApprovableAgentRunner', role: 'user' })
  .inputSchema(scSaveAgentRunner)
  .action(async ({ ctx: { user }, parsedInput }) => {
    await assertApprover(user.id, parsedInput.userId)

    await saveAgentRunnerConfig(parsedInput)
    return { userId: parsedInput.userId }
  })

/** カスタム指示(ルール)単体の保存 */
export const saveAgentRunnerRule = safeAuthAction
  .metadata({ actionName: 'saveApprovableAgentRunnerRule', role: 'user' })
  .inputSchema(scSaveAgentRunnerRule)
  .action(async ({ ctx: { user }, parsedInput: { userId, rule } }) => {
    await assertApprover(user.id, userId)

    await saveAgentRunnerRuleValue(userId, rule)
    return { userId }
  })

/** 実行履歴。件数が増え続けるので新しい順に上限まで返す */
export const getAgentRuns = safeAuthAction
  .metadata({ actionName: 'getApprovableAgentRuns', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await assertApprover(user.id, id)

    return await listAgentRuns(id)
  })
