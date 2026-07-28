'use server'

import { safeAuthAction } from '@/lib/action-server'
import {
  assertBoardAccess,
  assertBoardAssignee,
  assertTicketAccess,
  getAccessibleBoardIds,
  getBoardMemberUsers,
} from '@/lib/board'
import { dateOnlyToUtc } from '@/lib/day'
import { errInvalidOperation } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scCreateTicket, scTicketSearch, scUUID } from '@/lib/schema'
import { buildTicketWhere, MAX_TICKET_LIST, nextLaneOrder, resolveTicketAssignee, ticketScopeWhere } from '@/lib/task'

/** タグ候補の収集対象件数(全件走査を避けるための上限) */
const TAG_SCAN_LIMIT = 500

/**
 * チケット一覧取得(検索・フィルタ)
 *
 * usePagingList が全件をクライアントへ返す実装のため、本文(content)は含めず件数も上限を設ける。
 * 検索は where 側で行うので機能には影響しない。
 */
export const getTickets = safeAuthAction
  .metadata({ actionName: 'getTickets', role: 'user' })
  .inputSchema(scTicketSearch)
  .action(async ({ ctx: { user }, parsedInput }) => {
    const accessibleBoardIds = await getAccessibleBoardIds(user.id)
    const tickets = await prisma.ticket.findMany({
      where: buildTicketWhere(parsedInput, { userId: user.id, accessibleBoardIds }),
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        tags: true,
        dueDate: true,
        boardId: true,
        board: { select: { name: true } },
        assigneeId: true,
        assignee: { select: { name: true } },
        _count: { select: { comments: true } },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: MAX_TICKET_LIST,
    })

    return tickets.map(({ board, assignee, _count, ...ticket }) => ({
      ...ticket,
      boardName: board?.name ?? '',
      assigneeName: assignee?.name ?? '',
      commentCount: _count.comments,
    }))
  })
export type GetTicketsReturnType = Awaited<ReturnType<typeof getTickets>>['data']

/**
 * チケットのフォーム / 検索パネル用の選択肢
 *
 * 全ユーザー一覧は返さない(自分と、自分が参加しているボードのメンバーに限定する)。
 */
export const getTicketFormOptions = safeAuthAction
  .metadata({ actionName: 'getTicketFormOptions', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    const accessibleBoardIds = await getAccessibleBoardIds(user.id)

    const [boards, tagRows] = await Promise.all([
      prisma.board.findMany({
        where: { id: { in: accessibleBoardIds } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.ticket.findMany({
        where: ticketScopeWhere(user.id, accessibleBoardIds),
        select: { tags: true },
        orderBy: { updatedAt: 'desc' },
        take: TAG_SCAN_LIMIT,
      }),
    ])

    return {
      boards: Object.fromEntries(boards.map((board) => [board.id, board.name])) as Record<string, string>,
      tags: [...new Set(tagRows.flatMap((row) => row.tags))].sort(),
      me: { id: user.id, name: user.name },
    }
  })
export type GetTicketFormOptionsReturnType = Awaited<ReturnType<typeof getTicketFormOptions>>['data']

/**
 * 担当者の選択肢。ボード未指定(プライベート)なら自分のみ、ボード指定ならそのボードのメンバー。
 */
export const getAssigneeOptions = safeAuthAction
  .metadata({ actionName: 'getAssigneeOptions', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id: boardId } }) => {
    await assertBoardAccess(user, boardId, 'view')
    const users = await getBoardMemberUsers(boardId)
    return Object.fromEntries(users.map(({ id, name }) => [id, name])) as Record<string, string>
  })
export type GetAssigneeOptionsReturnType = Awaited<ReturnType<typeof getAssigneeOptions>>['data']

/**
 * チケット作成(プライベート / ボードの両方)
 *
 * 不変条件 `(boardId IS NULL) XOR (ownerId IS NULL)` はここで保証する。
 */
export const createTicket = safeAuthAction
  .metadata({ actionName: 'createTicket', role: 'user' })
  .inputSchema(scCreateTicket)
  .action(async ({ ctx: { user }, parsedInput: { boardId, status, assigneeId, tags, dueDate, ...rest } }) => {
    const ticket = await prisma.$transaction(async (tx) => {
      if (boardId) {
        // 参加しているボードのみ
        await assertBoardAccess(user, boardId, 'view', tx)
        // 担当者はそのボードのメンバーに限る
        await assertBoardAssignee(tx, boardId, assigneeId)
      } else if (assigneeId && assigneeId !== user.id) {
        // プライベートチケットは他人へ割り当てできない(正常な UI 操作では到達しない)
        throw errInvalidOperation()
      }

      // 対象レーンの末尾へ追加する
      const lane = await tx.ticket.findMany({
        where: boardId ? { boardId, status } : { boardId: null, ownerId: user.id, status },
        select: { order: true },
      })

      return tx.ticket.create({
        data: {
          ...rest,
          status,
          tags: [...new Set(tags)],
          dueDate: dateOnlyToUtc(dueDate),
          boardId: boardId ?? null,
          ownerId: boardId ? null : user.id,
          createdById: user.id,
          // プライベートチケットは所有者本人が自動的に担当者になる
          assigneeId: resolveTicketAssignee({ boardId: boardId ?? null, ownerId: user.id, requested: assigneeId }),
          order: nextLaneOrder(lane.map((row) => row.order)),
        },
        select: { id: true, title: true },
      })
    })

    logger.info({ userId: user.id, ticket }, 'ticket created')
    return ticket
  })

/**
 * チケット削除
 *
 * 詳細ページからも同じ Action を import して使う(重複定義を避ける)。
 */
export const deleteTicket = safeAuthAction
  .metadata({ actionName: 'deleteTicket', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await prisma.$transaction(async (tx) => {
      await assertTicketAccess(user, id, 'delete', tx)
      // TicketComment は onDelete: Cascade で自動削除される
      await tx.ticket.delete({ where: { id } })
    })

    logger.info({ userId: user.id, id }, 'ticket deleted')
    return { id }
  })
