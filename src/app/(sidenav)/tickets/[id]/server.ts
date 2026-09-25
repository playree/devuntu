'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { assertTicketAccess } from '@/lib/board/board-access'
import { TAG_SELECT } from '@/lib/board/tag'
import { ticketDisplayId, ticketShortPath } from '@/lib/board/ticket-id'
import { addComment, changeTicketStatus, deleteComment, updateComment, updateTicket } from '@/lib/board/ticket-mutation'
import { errInvalidOperation } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import {
  scCreateTicketComment,
  scPatchTicket,
  scUpdateTicketAgentMode,
  scUpdateTicketComment,
  scUpdateTicketStatus,
  scUUID,
} from '@/lib/schema/schema'
import { makeUrl } from '@/lib/server-utils'

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
          select: { tag: { select: TAG_SELECT } },
          orderBy: { tag: { order: 'asc' } },
        },
        assigneeId: true,
        assignee: { select: { name: true, isAgent: true } },
        createdBy: { select: { name: true } },
        agentMode: true,
        agentState: true,
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
      /** 担当がエージェントのときだけ、処理方式(`agentMode`)を選べるようにする */
      assigneeIsAgent: assignee?.isAgent ?? false,
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
      canEditAgentMode: access.canEditAgentMode,
    }
  })
export type GetTicketReturnType = Awaited<ReturnType<typeof getTicket>>['data']

/**
 * チケットの部分更新(詳細画面のインライン編集)
 *
 * 渡された項目だけを更新する(undefined = 変更しない / null = クリア)。
 * status はレーン位置の再採番を伴うため updateTicketStatus 側で扱う。
 * agentMode は承認者だけの操作なので updateTicketAgentMode 側で扱う。
 */
export const patchTicket = safeAuthAction
  .metadata({ actionName: 'patchTicket', role: 'user' })
  .inputSchema(scPatchTicket)
  .action(async ({ ctx: { user }, parsedInput: { id, ...input } }) => {
    const ticket = await updateTicket(user, id, input)

    logger.info({ userId: user.id, id }, 'ticket patched')
    return { id: ticket.id, title: ticket.title }
  })

/**
 * エージェントモードのみの更新(= エージェントの自動実行を承認する操作)
 *
 * 承認者はボードのメンバーとは限らず `patchTicket` の 'edit' を通せないため、
 * 専用アクションとして 'agentMode' で認可する。
 */
export const updateTicketAgentMode = safeAuthAction
  .metadata({ actionName: 'updateTicketAgentMode', role: 'user' })
  .inputSchema(scUpdateTicketAgentMode)
  .action(async ({ ctx: { user }, parsedInput: { id, agentMode } }) => {
    const access = await assertTicketAccess(user, id, 'agentMode')
    // 担当がエージェントでなくなった直後などに、意味を持たない値が残らないようにする
    if (!access.assigneeIsAgent) {
      throw errInvalidOperation()
    }

    // 選択待ちへ戻したら処理状態も消す(残すと履歴として誤読される)
    // 担当者がエージェントであることを更新条件に含め、確認〜更新の間に担当者が変わっても不整合が残らないようにする
    const result = await prisma.ticket.updateMany({
      where: { id, assignee: { isAgent: true } },
      data: { agentMode, ...(agentMode === null && { agentState: null }) },
    })
    if (result.count === 0) {
      throw errInvalidOperation()
    }

    logger.info({ userId: user.id, id, agentMode }, 'ticket agent mode updated')
    return { id, agentMode }
  })

/**
 * ステータスのみの更新(詳細画面・かんばんのカード内メニューから使う)
 */
export const updateTicketStatus = safeAuthAction
  .metadata({ actionName: 'updateTicketStatus', role: 'user' })
  .inputSchema(scUpdateTicketStatus)
  .action(async ({ ctx: { user }, parsedInput: { id, status } }) => {
    const moved = await changeTicketStatus(user, id, status)

    logger.info({ userId: user.id, ...moved }, 'ticket status updated')
    return moved
  })

/**
 * コメント投稿(メンションの解決を含む)
 */
export const addTicketComment = safeAuthAction
  .metadata({ actionName: 'addTicketComment', role: 'user' })
  .inputSchema(scCreateTicketComment)
  .action(async ({ ctx: { user }, parsedInput }) => {
    const comment = await addComment(user, parsedInput)

    logger.info({ userId: user.id, ticketId: parsedInput.ticketId, commentId: comment.id }, 'ticket comment added')
    return comment
  })

/**
 * コメント更新(投稿者本人のみ)
 */
export const updateTicketComment = safeAuthAction
  .metadata({ actionName: 'updateTicketComment', role: 'user' })
  .inputSchema(scUpdateTicketComment)
  .action(async ({ ctx: { user }, parsedInput: { id, content } }) => {
    const comment = await updateComment(user, id, content)

    logger.info({ userId: user.id, id }, 'ticket comment updated')
    return comment
  })

/**
 * コメント削除(投稿者本人、またはチケットを削除できる権限を持つ人)
 */
export const deleteTicketComment = safeAuthAction
  .metadata({ actionName: 'deleteTicketComment', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await deleteComment(user, id)

    logger.info({ userId: user.id, id }, 'ticket comment deleted')
    return { id }
  })
