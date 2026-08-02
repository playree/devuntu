'use server'

import { safeAuthAction } from '@/lib/action-server'
import { countTicketsByBoard, ensurePrivateBoard, listAccessibleBoards } from '@/lib/board'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scCreateBoard } from '@/lib/schema'
import { TICKET_STATUSES } from '@/lib/task'

/**
 * ボード一覧取得(自分がアサインされているボードのみ)
 *
 * プライベートボードもここに含まれるため、先に自動作成しておく。
 */
export const getBoards = safeAuthAction
  .metadata({ actionName: 'getBoards', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    await ensurePrivateBoard(user)

    const boards = await listAccessibleBoards(user.id, { includeArchived: true })
    const counts = await countTicketsByBoard(boards.map((board) => board.id))

    return boards.map((board) => {
      const byStatus = counts[board.id] ?? {}
      return {
        ...board,
        // 完了以外の件数を「対応中」として出すため、ステータス別と合計の両方を返す
        ticketCount: TICKET_STATUSES.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0),
        openCount: TICKET_STATUSES.filter((status) => status !== 'done').reduce(
          (sum, status) => sum + (byStatus[status] ?? 0),
          0,
        ),
      }
    })
  })
export type GetBoardsReturnType = Awaited<ReturnType<typeof getBoards>>['data']

/** ボード作成。作成者が owner になる */
export const createBoard = safeAuthAction
  .metadata({ actionName: 'createBoard', role: 'user' })
  .inputSchema(scCreateBoard)
  .action(async ({ ctx: { user }, parsedInput: { name, description } }) => {
    const board = await prisma.board.create({
      data: {
        // privateOwnerId は触らない(プライベートボードの作成経路は ensurePrivateBoard だけ)
        kind: 'team',
        name,
        description,
        members: { create: { userId: user.id, role: 'owner' } },
      },
      select: { id: true, name: true },
    })

    logger.info({ userId: user.id, board }, 'board created')
    return board
  })
