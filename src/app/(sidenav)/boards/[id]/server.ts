'use server'

import { safeAuthAction } from '@/lib/action-server'
import { assertBoardAccess, assertTicketAccess, isAdminActor, moveTicketToLane } from '@/lib/board'
import { errInvalidOperation } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scMoveTicket, scUUID } from '@/lib/schema'
import { groupByLane, MAX_KANBAN_CARDS } from '@/lib/task'

/**
 * かんばん表示用のボード + レーン別カード
 *
 * カードの並びは `moveTicketToLane` がレーン内順序を読むときの orderBy と必ず一致させること。
 * ズレるとクライアントが渡す index とサーバーが認識するレーン内位置が食い違う。
 */
export const getBoardKanban = safeAuthAction
  .metadata({ actionName: 'getBoardKanban', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    const access = await assertBoardAccess(user, id, 'view')

    const board = await prisma.board.findUnique({
      where: { id },
      select: { id: true, kind: true, name: true, description: true, archived: true },
    })
    if (!board) {
      throw errInvalidOperation()
    }

    const tickets = await prisma.ticket.findMany({
      where: { boardId: id },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        assigneeId: true,
        assignee: { select: { name: true, image: true } },
        tags: {
          select: { tag: { select: { id: true, name: true, color: true } } },
          orderBy: { tag: { order: 'asc' } },
        },
        _count: { select: { comments: true } },
      },
      // status は enum の宣言順(backlog,todo,doing,done)。上限で切れるのが done の末尾になるようにする
      orderBy: [{ status: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
      take: MAX_KANBAN_CARDS,
    })

    const cards = tickets.map(({ assignee, _count, tags, ...ticket }) => ({
      ...ticket,
      // 中間テーブルは表示側で扱わないので平坦化する
      tags: tags.map(({ tag }) => tag),
      assigneeName: assignee?.name ?? '',
      // 未設定は空文字にして、表示側は assigneeName と同じ falsy 判定で扱えるようにする
      assigneeImage: assignee?.image ?? '',
      commentCount: _count.comments,
    }))

    return {
      board: { ...board, description: board.description ?? '' },
      role: access.role,
      canManage: access.role === 'owner' || isAdminActor(user),
      total: cards.length,
      lanes: groupByLane(cards),
    }
  })
export type GetBoardKanbanReturnType = Awaited<ReturnType<typeof getBoardKanban>>['data']

/**
 * かんばんの DnD / カード内ステータス変更の書き込み経路
 *
 * 認可はチケット起点(assertTicketAccess)なので boardId は入力に不要。
 * レーンは「同一ボード + 同一ステータス」で決まるため、他ボードへは移動できない。
 */
export const moveTicket = safeAuthAction
  .metadata({ actionName: 'moveTicket', role: 'user' })
  .inputSchema(scMoveTicket)
  .action(async ({ ctx: { user }, parsedInput: { id, status, index } }) => {
    const moved = await prisma.$transaction(async (tx) => {
      const access = await assertTicketAccess(user, id, 'edit', tx)
      return moveTicketToLane(tx, { access, status, index })
    })

    logger.info({ userId: user.id, ...moved }, 'ticket moved')
    return moved
  })
