'use server'

import { safeAuthAction } from '@/lib/action-server'
import { assertBoardAssignee, assertTicketAccess, getTicketMentionCandidates, moveTicketToLane } from '@/lib/board'
import { dateOnlyToUtc } from '@/lib/day'
import { errInvalidOperation } from '@/lib/error'
import { logger } from '@/lib/logger'
import { notifyMention } from '@/lib/notify-mention'
import { prisma } from '@/lib/prisma'
import { scCreateTicketComment, scPatchTicket, scUpdateTicketComment, scUpdateTicketStatus, scUUID } from '@/lib/schema'
import { assertTagIdsInBoard, syncTicketTags } from '@/lib/tag'
import { extractMentionNames, resolveMentionUserIds } from '@/lib/task'

/**
 * チケット詳細取得(本文 + コメント + 権限)
 *
 * 権限は画面側のボタン表示に使う。クライアントの非表示だけに頼らず各 Action でも検証する。
 */
export const getTicket = safeAuthAction
  .metadata({ actionName: 'getTicket', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    const access = await assertTicketAccess(user, id, 'view')

    const ticket = await prisma.ticket.findUnique({
      where: { id },
      select: {
        id: true,
        boardId: true,
        board: { select: { name: true, kind: true } },
        title: true,
        content: true,
        status: true,
        priority: true,
        dueDate: true,
        tags: {
          select: { tag: { select: { id: true, boardId: true, name: true, color: true, order: true } } },
          orderBy: { tag: { order: 'asc' } },
        },
        assigneeId: true,
        assignee: { select: { name: true } },
        createdBy: { select: { name: true } },
        createdAt: true,
        updatedAt: true,
        comments: {
          select: {
            id: true,
            content: true,
            authorId: true,
            author: { select: { name: true } },
            mentionedUserIds: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })
    if (!ticket) {
      throw errInvalidOperation()
    }

    // メンション済みユーザーの表示名を解決する(投稿時点のスナップショットなので存在しない ID もあり得る)
    const mentionedIds = [...new Set(ticket.comments.flatMap((comment) => comment.mentionedUserIds))]
    const mentionedUsers =
      mentionedIds.length > 0
        ? await prisma.user.findMany({ where: { id: { in: mentionedIds } }, select: { id: true, name: true } })
        : []
    const nameById = new Map(mentionedUsers.map((u) => [u.id, u.name]))

    const { board, assignee, createdBy, comments, tags, ...rest } = ticket
    return {
      ...rest,
      // 中間テーブルは表示側で扱わないので平坦化する
      tags: tags.map(({ tag }) => tag),
      boardName: board.name,
      boardKind: board.kind,
      assigneeName: assignee?.name ?? '',
      createdByName: createdBy?.name ?? '',
      comments: comments.map(({ author, mentionedUserIds, ...comment }) => ({
        ...comment,
        authorName: author?.name ?? '',
        mentionedNames: mentionedUserIds.flatMap((userId) => {
          const name = nameById.get(userId)
          return name ? [name] : []
        }),
        isMine: comment.authorId === user.id,
      })),
      boardRole: access.boardRole,
      canEdit: access.canEdit,
      canDelete: access.canDelete,
    }
  })
export type GetTicketReturnType = Awaited<ReturnType<typeof getTicket>>['data']

/**
 * チケットの部分更新(詳細画面のインライン編集)
 *
 * 渡された項目だけを更新する(undefined = 変更しない / null = クリア)。
 * status はレーン位置の再採番を伴うため updateTicketStatus 側で扱う。
 */
export const patchTicket = safeAuthAction
  .metadata({ actionName: 'patchTicket', role: 'user' })
  .inputSchema(scPatchTicket)
  .action(async ({ ctx: { user }, parsedInput: { id, assigneeId, tagIds, dueDate, ...rest } }) => {
    const ticket = await prisma.$transaction(async (tx) => {
      const access = await assertTicketAccess(user, id, 'edit', tx)

      // 担当者・タグはそのボードに属するものに限る(DB 制約では防げない)
      if (assigneeId !== undefined) {
        await assertBoardAssignee(tx, access.boardId, assigneeId)
      }
      const ids = tagIds !== undefined ? await assertTagIdsInBoard(tx, access.boardId, tagIds) : undefined

      const updated = await tx.ticket.update({
        where: { id },
        data: {
          // title / content / priority は未指定なら undefined = 無変更
          ...rest,
          ...(dueDate !== undefined && { dueDate: dateOnlyToUtc(dueDate) }),
          ...(assigneeId !== undefined && { assigneeId: assigneeId ?? null }),
        },
        select: { id: true, title: true },
      })
      if (ids) {
        await syncTicketTags(tx, id, ids)
      }

      return updated
    })

    logger.info({ userId: user.id, id }, 'ticket patched')
    return ticket
  })

/**
 * ステータスのみの更新(詳細画面・かんばんのカード内メニューから使う)
 */
export const updateTicketStatus = safeAuthAction
  .metadata({ actionName: 'updateTicketStatus', role: 'user' })
  .inputSchema(scUpdateTicketStatus)
  .action(async ({ ctx: { user }, parsedInput: { id, status } }) => {
    const moved = await prisma.$transaction(async (tx) => {
      const access = await assertTicketAccess(user, id, 'edit', tx)
      return moveTicketToLane(tx, { access, status })
    })

    logger.info({ userId: user.id, ...moved }, 'ticket status updated')
    return moved
  })

/**
 * コメント投稿(メンションの解決を含む)
 */
export const addTicketComment = safeAuthAction
  .metadata({ actionName: 'addTicketComment', role: 'user' })
  .inputSchema(scCreateTicketComment)
  .action(async ({ ctx: { user }, parsedInput: { ticketId, content } }) => {
    const { comment, mentionedUserIds } = await prisma.$transaction(async (tx) => {
      const access = await assertTicketAccess(user, ticketId, 'edit', tx)

      const candidates = await getTicketMentionCandidates(access, tx)
      const mentionedUserIds = resolveMentionUserIds(extractMentionNames(content), candidates)

      const comment = await tx.ticketComment.create({
        data: { ticketId, authorId: user.id, content, mentionedUserIds },
        select: { id: true },
      })

      // 検索(更新日時順)の観点でチケット側の updatedAt も更新する
      await tx.ticket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } })

      return { comment, mentionedUserIds }
    })

    // 通知は未実装(ログのみ)
    await notifyMention({ ticketId, commentId: comment.id, fromUserId: user.id, toUserIds: mentionedUserIds })

    logger.info({ userId: user.id, ticketId, commentId: comment.id }, 'ticket comment added')
    return { id: comment.id, mentionedUserIds }
  })

/**
 * コメント更新(投稿者本人のみ)
 */
export const updateTicketComment = safeAuthAction
  .metadata({ actionName: 'updateTicketComment', role: 'user' })
  .inputSchema(scUpdateTicketComment)
  .action(async ({ ctx: { user }, parsedInput: { id, content } }) => {
    const mentionedUserIds = await prisma.$transaction(async (tx) => {
      const target = await tx.ticketComment.findUnique({
        where: { id },
        select: { ticketId: true, authorId: true },
      })
      if (!target || target.authorId !== user.id) {
        throw errInvalidOperation()
      }

      const access = await assertTicketAccess(user, target.ticketId, 'edit', tx)
      const candidates = await getTicketMentionCandidates(access, tx)
      const mentionedUserIds = resolveMentionUserIds(extractMentionNames(content), candidates)

      await tx.ticketComment.update({ where: { id }, data: { content, mentionedUserIds } })
      return mentionedUserIds
    })

    logger.info({ userId: user.id, id }, 'ticket comment updated')
    return { id, mentionedUserIds }
  })

/**
 * コメント削除(投稿者本人、またはチケットを削除できる権限を持つ人)
 */
export const deleteTicketComment = safeAuthAction
  .metadata({ actionName: 'deleteTicketComment', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await prisma.$transaction(async (tx) => {
      const target = await tx.ticketComment.findUnique({
        where: { id },
        select: { ticketId: true, authorId: true },
      })
      if (!target) {
        throw errInvalidOperation()
      }

      const access = await assertTicketAccess(user, target.ticketId, 'edit', tx)
      if (target.authorId !== user.id && !access.canDelete) {
        throw errInvalidOperation()
      }

      await tx.ticketComment.delete({ where: { id } })
    })

    logger.info({ userId: user.id, id }, 'ticket comment deleted')
    return { id }
  })

/**
 * メンション候補(コメント入力のヒント表示に使う)
 */
export const getMentionCandidates = safeAuthAction
  .metadata({ actionName: 'getMentionCandidates', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    const access = await assertTicketAccess(user, id, 'view')
    return getTicketMentionCandidates(access)
  })
export type GetMentionCandidatesReturnType = Awaited<ReturnType<typeof getMentionCandidates>>['data']
