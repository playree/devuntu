'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import {
  countTicketsByBoard,
  ensurePrivateBoard,
  listAccessibleBoards,
  reserveBoardKey,
  rethrowDuplicatedBoardKey,
} from '@/lib/board/board'
import { TICKET_STATUSES } from '@/lib/board/task'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scCreateBoard } from '@/lib/schema/schema'

/**
 * ボード一覧取得(自分がアサインされているボードのみ)
 *
 * プライベートボードもここに含まれるため、先に自動作成しておく。
 */
export const getBoards = safeAuthAction
  .metadata({ actionName: 'getBoards', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    await ensurePrivateBoard(user)

    // 表示の出し入れは一覧側のスイッチ(クライアントフィルタ)で行うため、アーカイブ済みも含めて返す
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
  .action(async ({ ctx: { user }, parsedInput: { name, key, description } }) => {
    const board = await prisma.$transaction(async (tx) => {
      const created = await tx.board
        .create({
          data: {
            // privateOwnerId は触らない(プライベートボードの作成経路は ensurePrivateBoard だけ)
            kind: 'team',
            name,
            key,
            description,
            members: { create: { userId: user.id, role: 'owner' } },
          },
          select: { id: true, name: true },
        })
        .catch(rethrowDuplicatedBoardKey)

      // 過去に他のボードが使ったキーは再利用させない(共有済みの表示IDが別ボードを指さないようにする)
      await reserveBoardKey(tx, key, created.id)
      return created
    })

    logger.info({ userId: user.id, board }, 'board created')
    return board
  })
