'use server'

import { safeAuthAction } from '@/lib/action-server'
import {
  assertBoardAccess,
  assertBoardAssignee,
  assertTicketAccess,
  ensurePrivateBoard,
  getAccessibleBoardIds,
  getBoardMemberUsers,
} from '@/lib/board'
import { dateOnlyToUtc } from '@/lib/day'
import { errInvalidOperation } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scCreateTag, scCreateTicket, scTicketSearch, scUUID } from '@/lib/schema'
import { assertTagIdsInBoard, listVisibleTags, rethrowDuplicatedTagName } from '@/lib/tag'
import { buildTicketWhere, MAX_TAGS_PER_SCOPE, MAX_TICKET_LIST, nextLaneOrder, nextTagOrder } from '@/lib/task'

/** タグの選択肢として返す列。`lib/tag.ts` の TagOption と一致させる */
const TAG_SELECT = { id: true, boardId: true, name: true, color: true, order: true } as const

/** チケット一覧・詳細で共有する select。TicketTag を平坦化するために使う */
const TICKET_TAGS_SELECT = { select: { tag: { select: TAG_SELECT } }, orderBy: { tag: { order: 'asc' } } } as const

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
    // プライベートチケットもボード経由で可視化するため、先にプライベートボードを用意する
    await ensurePrivateBoard(user)
    const accessibleBoardIds = await getAccessibleBoardIds(user.id)

    const tickets = await prisma.ticket.findMany({
      where: buildTicketWhere(parsedInput, { userId: user.id, accessibleBoardIds }),
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        tags: TICKET_TAGS_SELECT,
        dueDate: true,
        boardId: true,
        board: { select: { name: true, kind: true } },
        assigneeId: true,
        assignee: { select: { name: true } },
        _count: { select: { comments: true } },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: MAX_TICKET_LIST,
    })

    return tickets.map(({ board, assignee, _count, tags, ...ticket }) => ({
      ...ticket,
      // 中間テーブルは表示側で扱わないので平坦化する
      tags: tags.map(({ tag }) => tag),
      boardName: board.name,
      boardKind: board.kind,
      assigneeName: assignee?.name ?? '',
      commentCount: _count.comments,
    }))
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

    const [boards, tags] = await Promise.all([
      prisma.board.findMany({
        where: { id: { in: accessibleBoardIds } },
        select: { id: true, name: true, kind: true },
        // BoardKind は enum の宣言順で比較されるためプライベートが先頭に来る
        orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      }),
      listVisibleTags(accessibleBoardIds),
    ])

    return { boards, tags, privateBoardId }
  })
export type GetTicketFormOptionsReturnType = Awaited<ReturnType<typeof getTicketFormOptions>>['data']

/**
 * チケット編集中のタグ新規作成。
 *
 * タグの管理(リネーム / 削除 / 統合)は /boards/[id] 側だが、作成だけはチケットを
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
        data: { boardId, name, color, order: order || nextTagOrder(tags.map((row) => row.order)) },
        select: TAG_SELECT,
      })
      .catch(async (e) => {
        const raced = await prisma.tag.findUnique({ where: { boardId_name: { boardId, name } }, select: TAG_SELECT })
        return raced ?? rethrowDuplicatedTagName(e)
      })

    logger.info({ userId: user.id, tag }, 'tag created')
    return tag
  })

/** 担当者の選択肢。そのボードのメンバー(プライベートボードなら本人のみ) */
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
      await assertBoardAccess(user, boardId, 'view', tx)
      // 担当者はそのボードのメンバーに限る
      await assertBoardAssignee(tx, boardId, assigneeId)
      // タグもそのボードのものに限る
      const ids = await assertTagIdsInBoard(tx, boardId, tagIds)

      // 対象レーンの末尾へ追加する
      const lane = await tx.ticket.findMany({ where: { boardId, status }, select: { order: true } })

      return tx.ticket.create({
        data: {
          ...rest,
          status,
          boardId,
          dueDate: dateOnlyToUtc(dueDate),
          createdById: user.id,
          assigneeId: assigneeId ?? null,
          tags: { create: ids.map((tagId) => ({ tagId })) },
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
