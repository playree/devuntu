'use server'

import { safeAuthAction } from '@/lib/action-server'
import {
  assertBoardAccess,
  assertBoardAssignee,
  assertTicketAccess,
  ensurePrivateBoard,
  getAccessibleBoardIds,
  getBoardMemberUsers,
  getBoardsMemberUsers,
  nextTicketNumber,
} from '@/lib/board'
import { dateOnlyToUtc, nowDate } from '@/lib/day'
import { errInvalidOperation } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scCreateTag, scCreateTicket, scTicketListQuery, scUUID } from '@/lib/schema'
import { assertTagIdsInBoard, listVisibleTags, rethrowDuplicatedTagName } from '@/lib/tag'
import { buildTicketWhere, MAX_TAGS_PER_SCOPE, nextOrder, ticketDisplayId, ticketListOrderBy } from '@/lib/task'

/** タグの選択肢として返す列。`lib/tag.ts` の TagOption と一致させる */
const TAG_SELECT = { id: true, boardId: true, name: true, color: true, order: true } as const

/** チケット一覧・詳細で共有する select。TicketTag を平坦化するために使う */
const TICKET_TAGS_SELECT = { select: { tag: { select: TAG_SELECT } }, orderBy: { tag: { order: 'asc' } } } as const

/**
 * チケット一覧取得(検索・フィルタ・ページング)
 *
 * 検索・絞り込み・並び替え・ページ切り出しをすべてサーバー側で行い、1 ページ分だけを返す。
 * 全件返しでは件数上限を超えた行に到達できなかったため、上限は設けていない。
 * 一覧では本文(content)を表示しないので select には含めない。
 */
export const getTickets = safeAuthAction
  .metadata({ actionName: 'getTickets', role: 'user' })
  .inputSchema(scTicketListQuery)
  .action(async ({ ctx: { user }, parsedInput: { page, rowsPerPage, sortColumn, sortDirection, ...search } }) => {
    // プライベートチケットもボード経由で可視化するため、先にプライベートボードを用意する
    await ensurePrivateBoard(user)
    const accessibleBoardIds = await getAccessibleBoardIds(user.id)

    // 総件数とページ内容で同じ条件を使う(ページャの総ページ数と表示行がずれないようにする)
    const where = buildTicketWhere(search, { accessibleBoardIds })

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
          tags: TICKET_TAGS_SELECT,
          dueDate: true,
          boardId: true,
          board: { select: { name: true, kind: true, key: true } },
          assigneeId: true,
          assignee: { select: { name: true } },
          _count: { select: { comments: true } },
          createdAt: true,
          updatedAt: true,
        },
        orderBy: ticketListOrderBy(sortColumn, sortDirection),
        skip: (page - 1) * rowsPerPage,
        take: rowsPerPage,
      }),
    ])

    return {
      items: tickets.map(({ board, assignee, _count, tags, ...ticket }) => ({
        ...ticket,
        // 中間テーブルは表示側で扱わないので平坦化する
        tags: tags.map(({ tag }) => tag),
        // 表示ID はボードキーとの組で決まるので、組み立てはサーバー側に寄せる
        displayId: ticketDisplayId({ key: board.key, number: ticket.number }),
        boardName: board.name,
        boardKind: board.kind,
        assigneeName: assignee?.name ?? '',
        commentCount: _count.comments,
      })),
      total,
    }
  })
export type GetTicketsReturnType = Awaited<ReturnType<typeof getTickets>>['data']

/**
 * チケットのフォーム / 検索パネル用の選択肢
 *
 * 全ユーザー一覧は返さない(自分が参加しているボードのメンバーに限定する)。
 * タグはマスタ(Tag)から引くので、旧実装のようにチケットを走査して逆引きする必要はない。
 */
export const getTicketFormOptions = safeAuthAction
  .metadata({ actionName: 'getTicketFormOptions', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    const privateBoardId = await ensurePrivateBoard(user)
    const accessibleBoardIds = await getAccessibleBoardIds(user.id)

    const [boards, tags, assignees] = await Promise.all([
      prisma.board.findMany({
        where: { id: { in: accessibleBoardIds } },
        select: { id: true, name: true, kind: true },
        // BoardKind は enum の宣言順で比較されるためプライベートが先頭に来る
        orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      }),
      listVisibleTags(accessibleBoardIds),
      // 担当者の候補は絞り込み対象のボードが変わっても引き直さずに済むよう、タグと同じくまとめて返す
      getBoardsMemberUsers(accessibleBoardIds),
    ])

    // selfUserId はプライベートボードでの担当者の既定値(本人)を決めるために返す
    return { boards, tags, assignees, privateBoardId, selfUserId: user.id }
  })
export type GetTicketFormOptionsReturnType = Awaited<ReturnType<typeof getTicketFormOptions>>['data']

/**
 * チケット編集中のタグ新規作成。
 *
 * タグの管理(リネーム / 削除 / 統合)は /boards/[id]/settings 側だが、作成だけはチケットを
 * 書いている流れで必要になるため、メンバー権限で実行できるようにここへ置く。
 */
export const createTicketTag = safeAuthAction
  .metadata({ actionName: 'createTicketTag', role: 'user' })
  .inputSchema(scCreateTag)
  .action(async ({ ctx: { user }, parsedInput: { boardId, name, color, order } }) => {
    // タグ作成はメンバーなら可能(リネーム / 削除は manage が必要)
    await assertBoardAccess(user, boardId, 'view')

    // 同名が既にあればそれを返す(UI 上は作成せず選択だけさせたい)
    const existing = await prisma.tag.findUnique({ where: { boardId_name: { boardId, name } }, select: TAG_SELECT })
    if (existing) {
      return existing
    }

    const tags = await prisma.tag.findMany({ where: { boardId }, select: { order: true } })
    if (tags.length >= MAX_TAGS_PER_SCOPE) {
      throw errInvalidOperation()
    }

    // トランザクションにしないのは、PostgreSQL では一意制約違反でトランザクション全体が
    // 中断され、同じ tx 内で既存タグを読み直せなくなるため
    const tag = await prisma.tag
      .create({
        data: { boardId, name, color, order: order || nextOrder(tags.map((row) => row.order)) },
        select: TAG_SELECT,
      })
      .catch(async (e) => {
        const raced = await prisma.tag.findUnique({ where: { boardId_name: { boardId, name } }, select: TAG_SELECT })
        return raced ?? rethrowDuplicatedTagName(e)
      })

    logger.info({ userId: user.id, tag }, 'tag created')
    return tag
  })

/**
 * 担当者の選択肢。そのボードのメンバー(プライベートボードなら本人のみ)。
 * 並びは `getBoardMemberUsers` の名前順のまま。
 * 構造は `components/ticket/assignee-select.tsx` の AssigneeOption と一致させること。
 */
export const getAssigneeOptions = safeAuthAction
  .metadata({ actionName: 'getAssigneeOptions', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id: boardId } }) => {
    await assertBoardAccess(user, boardId, 'view')
    const users = await getBoardMemberUsers(boardId)
    return users.map(({ id, name, image }) => ({ id, name, image }))
  })
export type GetAssigneeOptionsReturnType = Awaited<ReturnType<typeof getAssigneeOptions>>['data']

/**
 * チケット作成
 *
 * プライベートもプライベートボードに属するため経路は 1 本。
 * 担当者・タグがそのボードに属することは DB 制約では防げないのでここで検証する。
 */
export const createTicket = safeAuthAction
  .metadata({ actionName: 'createTicket', role: 'user' })
  .inputSchema(scCreateTicket)
  .action(async ({ ctx: { user }, parsedInput: { boardId, status, assigneeId, tagIds, dueDate, ...rest } }) => {
    const ticket = await prisma.$transaction(async (tx) => {
      // 参加しているボードのみ
      const board = await assertBoardAccess(user, boardId, 'view', tx)
      // アーカイブ済みボードは読み取り専用(evaluateTicketAccess と同じ方針)
      if (board.archived) {
        throw errInvalidOperation()
      }
      // 担当者はそのボードのメンバーに限る
      await assertBoardAssignee(tx, boardId, assigneeId)
      // タグもそのボードのものに限る
      const ids = await assertTagIdsInBoard(tx, boardId, tagIds)

      // 対象レーンの末尾へ追加する。必要なのは最大値だけなので全行は読まない
      const lane = await tx.ticket.aggregate({ where: { boardId, status }, _max: { order: true } })
      // 採番はボード行をロックするので、他の検証を終えてから最後に取る
      const number = await nextTicketNumber(tx, boardId)

      const created = await tx.ticket.create({
        data: {
          ...rest,
          number,
          status,
          boardId,
          dueDate: dateOnlyToUtc(dueDate),
          // 最初から完了で作ることもできるので、その場合はここで完了日時を入れる
          completedAt: status === 'done' ? nowDate() : null,
          createdById: user.id,
          assigneeId: assigneeId ?? null,
          tags: { create: ids.map((tagId) => ({ tagId })) },
          order: nextOrder(lane._max.order === null ? [] : [lane._max.order]),
        },
        select: { id: true, title: true, number: true, board: { select: { key: true } } },
      })

      // 表示IDは組み立てて返す(作成直後の通知でそのまま出せるようにする)
      return {
        id: created.id,
        title: created.title,
        displayId: ticketDisplayId({ key: created.board.key, number: created.number }),
      }
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
