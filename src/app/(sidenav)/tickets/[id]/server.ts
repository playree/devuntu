'use server'

import { safeAuthAction } from '@/lib/action-server'
import {
  assertBoardAssignee,
  assertReplyTarget,
  assertTicketAccess,
  getTicketMentionCandidates,
  moveTicketToLane,
} from '@/lib/board'
import { dateOnlyToUtc } from '@/lib/day'
import { errInvalidOperation } from '@/lib/error'
import { logger } from '@/lib/logger'
import { notifyMention } from '@/lib/notify/notify-mention'
import { prisma } from '@/lib/prisma'
import { scCreateTicketComment, scPatchTicket, scUpdateTicketComment, scUpdateTicketStatus, scUUID } from '@/lib/schema'
import { makeUrl } from '@/lib/server-utils'
import { assertTagIdsInBoard, syncTicketTags } from '@/lib/tag'
import { extractMentionEmails, resolveMentionUserIds, ticketDisplayId, ticketShortPath } from '@/lib/task'

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
        number: true,
        boardId: true,
        board: { select: { name: true, kind: true, key: true } },
        title: true,
        content: true,
        mentionedUserIds: true,
        status: true,
        priority: true,
        dueDate: true,
        completedAt: true,
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
            type: true,
            parentId: true,
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

    // メンション済みユーザーの表示名を解決する(保存時点のスナップショットなので存在しない ID もあり得る)
    const mentionedIds = [
      ...new Set([...ticket.mentionedUserIds, ...ticket.comments.flatMap((comment) => comment.mentionedUserIds)]),
    ]
    const mentionedUsers =
      mentionedIds.length > 0
        ? await prisma.user.findMany({ where: { id: { in: mentionedIds } }, select: { id: true, name: true } })
        : []
    const nameById = new Map(mentionedUsers.map((u) => [u.id, u.name]))
    const toMentionedNames = (userIds: string[]) =>
      userIds.flatMap((userId) => {
        const name = nameById.get(userId)
        return name ? [name] : []
      })

    const { board, assignee, createdBy, comments, tags, mentionedUserIds, ...rest } = ticket
    const displayId = ticketDisplayId({ key: board.key, number: rest.number })
    return {
      ...rest,
      mentionedNames: toMentionedNames(mentionedUserIds),
      // 中間テーブルは表示側で扱わないので平坦化する
      tags: tags.map(({ tag }) => tag),
      displayId,
      /**
       * 貼り付け用の絶対URL。詳細画面は一覧・かんばんのドロワーからも開くため、
       * オリジンを props で引き回さずここで組み立てる(メンション通知や Slack と同じ短縮URL)。
       */
      shortUrl: makeUrl(ticketShortPath(displayId)).toString(),
      boardName: board.name,
      boardKind: board.kind,
      assigneeName: assignee?.name ?? '',
      createdByName: createdBy?.name ?? '',
      // スレッドは 1 階層のみなので、親コメントに自分宛の返信だけをぶら下げれば表示側は再帰不要
      comments: (() => {
        const flat = comments.map(({ author, mentionedUserIds: commentMentions, ...comment }) => ({
          ...comment,
          authorName: author?.name ?? '',
          mentionedNames: toMentionedNames(commentMentions),
          isMine: comment.authorId === user.id,
        }))
        return flat
          .filter((comment) => !comment.parentId)
          .map((comment) => ({
            ...comment,
            replies: flat.filter((reply) => reply.parentId === comment.id),
          }))
      })(),
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
    const { ticket, addedMentionUserIds } = await prisma.$transaction(async (tx) => {
      const access = await assertTicketAccess(user, id, 'edit', tx)

      // 担当者・タグはそのボードに属するものに限る(DB 制約では防げない)
      if (assigneeId !== undefined) {
        await assertBoardAssignee(tx, access.boardId, assigneeId)
      }
      const ids = tagIds !== undefined ? await assertTagIdsInBoard(tx, access.boardId, tagIds) : undefined

      // 本文を書き換えるときだけメンションを解き直す
      let mentionedUserIds: string[] | undefined
      let addedMentionUserIds: string[] = []
      if (rest.content !== undefined) {
        const before = await tx.ticket.findUniqueOrThrow({ where: { id }, select: { mentionedUserIds: true } })
        const candidates = await getTicketMentionCandidates(access, tx)
        mentionedUserIds = resolveMentionUserIds(extractMentionEmails(rest.content ?? ''), candidates)
        // 本文を編集し直すたびに同じ相手へ通知しないよう、増えた分だけを通知対象にする
        addedMentionUserIds = mentionedUserIds.filter((userId) => !before.mentionedUserIds.includes(userId))
      }

      const updated = await tx.ticket.update({
        where: { id },
        data: {
          // title / content / priority は未指定なら undefined = 無変更
          ...rest,
          ...(dueDate !== undefined && { dueDate: dateOnlyToUtc(dueDate) }),
          ...(assigneeId !== undefined && { assigneeId: assigneeId ?? null }),
          mentionedUserIds,
        },
        select: { id: true, title: true, number: true, board: { select: { key: true } } },
      })
      if (ids) {
        await syncTicketTags(tx, id, ids)
      }

      return { ticket: updated, addedMentionUserIds }
    })
    await notifyMention({
      ticketId: id,
      displayId: ticketDisplayId({ key: ticket.board.key, number: ticket.number }),
      ticketTitle: ticket.title,
      fromUserId: user.id,
      toUserIds: addedMentionUserIds,
    })

    logger.info({ userId: user.id, id }, 'ticket patched')
    return { id: ticket.id, title: ticket.title }
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
  .action(async ({ ctx: { user }, parsedInput: { ticketId, content, type, parentId } }) => {
    const { comment, mentionedUserIds, ticket } = await prisma.$transaction(async (tx) => {
      const access = await assertTicketAccess(user, ticketId, 'edit', tx)
      if (parentId) {
        await assertReplyTarget(tx, ticketId, parentId)
      }

      const candidates = await getTicketMentionCandidates(access, tx)
      const mentionedUserIds = resolveMentionUserIds(extractMentionEmails(content), candidates)

      const comment = await tx.ticketComment.create({
        data: { ticketId, authorId: user.id, content, type, parentId, mentionedUserIds },
        select: { id: true },
      })

      // 検索(更新日時順)の観点でチケット側の updatedAt も更新する
      // 通知の見出しに使う表示ID / 件名はこの update の戻りから取る(追加の SELECT を増やさない)
      const ticket = await tx.ticket.update({
        where: { id: ticketId },
        data: { updatedAt: new Date() },
        select: { number: true, title: true, board: { select: { key: true } } },
      })

      return { comment, mentionedUserIds, ticket }
    })
    await notifyMention({
      ticketId,
      displayId: ticketDisplayId({ key: ticket.board.key, number: ticket.number }),
      ticketTitle: ticket.title,
      commentId: comment.id,
      commentContent: content,
      fromUserId: user.id,
      toUserIds: mentionedUserIds,
    })

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
    const { mentionedUserIds, addedMentionUserIds, ticketId, ticket } = await prisma.$transaction(async (tx) => {
      const target = await tx.ticketComment.findUnique({
        where: { id },
        select: {
          ticketId: true,
          authorId: true,
          mentionedUserIds: true,
          // 通知の見出しに使う表示ID / 件名。この SELECT で併せて取り、追加の問い合わせを増やさない
          ticket: { select: { number: true, title: true, board: { select: { key: true } } } },
        },
      })
      if (!target || target.authorId !== user.id) {
        throw errInvalidOperation()
      }

      const access = await assertTicketAccess(user, target.ticketId, 'edit', tx)
      const candidates = await getTicketMentionCandidates(access, tx)
      const mentionedUserIds = resolveMentionUserIds(extractMentionEmails(content), candidates)

      await tx.ticketComment.update({ where: { id }, data: { content, mentionedUserIds } })
      // 検索(更新日時順)の観点でチケット側の updatedAt も更新する
      await tx.ticket.update({ where: { id: target.ticketId }, data: { updatedAt: new Date() } })
      return {
        mentionedUserIds,
        // コメントを編集し直すたびに同じ相手へ通知しないよう、増えた分だけを通知対象にする
        addedMentionUserIds: mentionedUserIds.filter((userId) => !target.mentionedUserIds.includes(userId)),
        ticketId: target.ticketId,
        ticket: target.ticket,
      }
    })
    await notifyMention({
      ticketId,
      displayId: ticketDisplayId({ key: ticket.board.key, number: ticket.number }),
      ticketTitle: ticket.title,
      commentId: id,
      commentContent: content,
      fromUserId: user.id,
      toUserIds: addedMentionUserIds,
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
