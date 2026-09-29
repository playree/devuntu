'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { assertBoardAccess, isAdminActor } from '@/lib/board/board-access'
import { groupByLane, kanbanDoneSince, kanbanTicketWhere, MAX_KANBAN_CARDS } from '@/lib/board/kanban'
import { ticketDisplayId } from '@/lib/board/ticket-id'
import { changeTicketStatus } from '@/lib/board/ticket-mutation'
import { childProgress } from '@/lib/board/ticket-relation-rule'
import { findWaitingTicketIds } from '@/lib/board/ticket-sequence'
import { nowDate } from '@/lib/day'
import { errInvalidOperation } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scUUID } from '@/lib/schema/schema'
import { scMoveTicket } from '@/lib/schema/schema-ticket'

/**
 * かんばん表示用のボード + レーン別カード
 *
 * カードの並びは `moveTicketToLane` がレーン内順序を読むときの orderBy と必ず一致させること。
 * ズレるとクライアントが渡す index とサーバーが認識するレーン内位置が食い違う。
 * 表示対象の条件(古い完了を落とす)も同様で、`moveTicketToLane` 側は同じ条件の
 * `kanbanLaneWhere`(レーン単位)で採番対象を絞っている。
 */
export const getBoardKanban = safeAuthAction
  .metadata({ actionName: 'getBoardKanban', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    const access = await assertBoardAccess(user, id, 'view')

    const board = await prisma.board.findUnique({
      where: { id },
      select: { id: true, kind: true, key: true, name: true, description: true, archived: true },
    })
    if (!board) {
      throw errInvalidOperation()
    }

    const tickets = await prisma.ticket.findMany({
      // 完了から KANBAN_DONE_VISIBLE_DAYS を過ぎたカードは盤面から落とす(一覧 /tickets からは引き続き見える)
      where: kanbanTicketWhere(id, kanbanDoneSince(nowDate())),
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        completedAt: true,
        assigneeId: true,
        assignee: { select: { name: true, image: true, isAgent: true } },
        agentMode: true,
        agentState: true,
        tags: {
          select: { tag: { select: { id: true, name: true, color: true } } },
          orderBy: { tag: { order: 'asc' } },
        },
        _count: { select: { comments: true } },
        // 子の進み具合・親の表示ID(参照は 1 階層だけ)・関連の表示ID。同じリレーションは 2 回 select できないので型で振り分ける
        relationsFrom: {
          where: { type: { in: ['parent', 'related'] } },
          select: { type: true, to: { select: { number: true, status: true } } },
        },
        relationsTo: {
          where: { type: { in: ['parent', 'related'] } },
          select: { type: true, from: { select: { number: true } } },
        },
      },
      // status は enum の宣言順(backlog,todo,doing,done)。上限で切れるのが done の末尾になるようにする
      orderBy: [{ status: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
      take: MAX_KANBAN_CARDS,
    })

    // 順番待ちを出すのは、エージェントに任せた未完了の子だけ(それ以外では処理状態を出さない)
    const waiting = await findWaitingTicketIds(
      tickets
        .filter((ticket) => ticket.assignee?.isAgent && ticket.agentMode && ticket.status !== 'done')
        .map((ticket) => ticket.id),
    )

    const cards = tickets.map(({ assignee, _count, tags, relationsFrom, relationsTo, ...ticket }) => {
      const parent = relationsTo.find(({ type }) => type === 'parent')
      return {
        ...ticket,
        // 中間テーブルは表示側で扱わないので平坦化する
        tags: tags.map(({ tag }) => tag),
        // 同一ボードのカードなので接頭辞は共通だが、表示側で組み立てを持たせないよう揃えて返す
        displayId: ticketDisplayId({ key: board.key, number: ticket.number }),
        assigneeName: assignee?.name ?? '',
        // 未設定は空文字にして、表示側は assigneeName と同じ falsy 判定で扱えるようにする
        assigneeImage: assignee?.image ?? '',
        assigneeIsAgent: assignee?.isAgent ?? false,
        commentCount: _count.comments,
        childProgress: childProgress(relationsFrom.filter(({ type }) => type === 'parent').map(({ to }) => to.status)),
        // 親子・関連は同じボードの中だけなので、接頭辞はこのボードのキーで組み立てられる
        parentDisplayId: parent ? ticketDisplayId({ key: board.key, number: parent.from.number }) : '',
        relatedDisplayIds: [
          ...relationsFrom.filter(({ type }) => type === 'related').map(({ to }) => to.number),
          ...relationsTo.filter(({ type }) => type === 'related').map(({ from }) => from.number),
        ].map((number) => ticketDisplayId({ key: board.key, number })),
        isWaiting: waiting.has(ticket.id),
      }
    })

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
    const moved = await changeTicketStatus(user, id, status, index)

    logger.info({ userId: user.id, ...moved }, 'ticket moved')
    return moved
  })
