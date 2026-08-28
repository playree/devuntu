import type { TicketCommentType, TicketPriority, TicketStatus } from '@/generated/prisma/enums'
import {
  assertBoardAccess,
  assertBoardAssignee,
  assertReplyTarget,
  assertTicketAccess,
  findTicketIdByDisplayId,
  getAccessibleBoardIds,
  getBoardMentionCandidates,
  getTicketMentionCandidates,
  moveTicketToLane,
  nextTicketNumber,
} from '@/lib/board/board'
import { assertTagIdsInBoard, syncTicketTags } from '@/lib/board/tag'
import {
  buildTicketWhere,
  canMcpDeleteTicket,
  canMcpUpdateTicket,
  extractMentionEmails,
  nextOrder,
  parseTicketDisplayId,
  resolveMentionUserIds,
  ticketDisplayId,
  ticketListOrderBy,
  ticketShortPath,
} from '@/lib/board/task'
import { dateOnlyToUtc, nowDate } from '@/lib/day'
import { errInvalidOperation } from '@/lib/error'
import { logger } from '@/lib/logger'
import { notifyMention } from '@/lib/notify/notify-mention'
import type { ResourceAuth } from '@/lib/oauth/oauth-resource'
import { prisma } from '@/lib/prisma'
import { makeUrl } from '@/lib/server-utils'

/** 表示ID(ABC-42)でもチケットIDでも受け取れるようにする。エージェント向けツールからも使う */
export const resolveTicketId = async (auth: ResourceAuth, ticketIdOrDisplayId: string): Promise<string> => {
  if (!parseTicketDisplayId(ticketIdOrDisplayId)) {
    return ticketIdOrDisplayId
  }
  const id = await findTicketIdByDisplayId(auth.user, ticketIdOrDisplayId)
  if (!id) {
    throw errInvalidOperation()
  }
  return id
}

export const getTicketForMcp = async (auth: ResourceAuth, ticketIdOrDisplayId: string) => {
  const id = await resolveTicketId(auth, ticketIdOrDisplayId)
  const access = await assertTicketAccess(auth.user, id, 'view')

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: {
      number: true,
      board: { select: { name: true, key: true } },
      title: true,
      content: true,
      status: true,
      priority: true,
      dueDate: true,
      completedAt: true,
      tags: { select: { tag: { select: { name: true } } }, orderBy: { tag: { order: 'asc' } } },
      assignee: { select: { name: true } },
      createdBy: { select: { name: true } },
      createdAt: true,
      updatedAt: true,
      comments: {
        select: { id: true, content: true, author: { select: { name: true } }, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!ticket) {
    throw errInvalidOperation()
  }

  const displayId = ticketDisplayId({ key: ticket.board.key, number: ticket.number })
  return {
    displayId,
    boardName: ticket.board.name,
    title: ticket.title,
    content: ticket.content,
    status: ticket.status,
    priority: ticket.priority,
    dueDate: ticket.dueDate,
    completedAt: ticket.completedAt,
    tags: ticket.tags.map(({ tag }) => tag.name),
    assigneeName: ticket.assignee?.name ?? '',
    createdByName: ticket.createdBy?.name ?? '',
    canEdit: access.canEdit,
    canDelete: access.canDelete,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    shortUrl: makeUrl(ticketShortPath(displayId)).toString(),
    comments: ticket.comments.map((comment) => ({
      id: comment.id,
      authorName: comment.author?.name ?? '',
      content: comment.content,
      createdAt: comment.createdAt,
    })),
  }
}

/** `search_tickets` の `assignee` に指定できる自分自身の別名。担当チケットの巡回に使う */
export const MCP_ASSIGNEE_ME = 'me'

export type McpTicketSearchInput = {
  keyword?: string
  status?: TicketStatus[]
  priority?: TicketPriority[]
  tags?: string[]
  boardId?: string
  /** ユーザーID / `me`(自分) / `none`(未割り当て) */
  assignee?: string
  limit?: number
}

/** `assignee` の指定を buildTicketWhere が解釈する形へ揃える */
const resolveAssignee = (assignee: string | undefined, userId: string): string | null =>
  assignee === MCP_ASSIGNEE_ME ? userId : (assignee ?? null)

const DEFAULT_SEARCH_LIMIT = 20
const MAX_SEARCH_LIMIT = 50

export const searchTicketsForMcp = async (auth: ResourceAuth, input: McpTicketSearchInput) => {
  const accessibleBoardIds = await getAccessibleBoardIds(auth.user.id)
  const where = buildTicketWhere(
    {
      keyword: input.keyword ?? '',
      status: input.status ?? [],
      priority: input.priority ?? [],
      tags: input.tags ?? [],
      boardId: input.boardId ?? null,
      assignee: resolveAssignee(input.assignee, auth.user.id),
    },
    { accessibleBoardIds },
  )

  const tickets = await prisma.ticket.findMany({
    where,
    select: {
      number: true,
      title: true,
      status: true,
      priority: true,
      board: { select: { name: true, key: true } },
      assignee: { select: { name: true } },
      _count: { select: { comments: true } },
      updatedAt: true,
    },
    orderBy: ticketListOrderBy('updatedAt', 'descending'),
    take: Math.min(input.limit ?? DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT),
  })

  return tickets.map((ticket) => ({
    displayId: ticketDisplayId({ key: ticket.board.key, number: ticket.number }),
    boardName: ticket.board.name,
    title: ticket.title,
    status: ticket.status,
    priority: ticket.priority,
    assigneeName: ticket.assignee?.name ?? '',
    commentCount: ticket._count.comments,
    updatedAt: ticket.updatedAt,
  }))
}

export type McpCreateTicketInput = {
  boardId: string
  title: string
  content?: string
  status?: TicketStatus
  priority?: TicketPriority
  dueDate?: string | null
  assigneeId?: string | null
  tagIds?: string[]
}

/**
 * MCP経由のチケット作成。追加制限は無く、Web版の createTicket アクションと同じ権限判定を使う。
 */
export const createTicketForMcp = async (auth: ResourceAuth, input: McpCreateTicketInput) => {
  const { boardId, title, content, status = 'todo', priority = 'medium', dueDate, assigneeId, tagIds = [] } = input

  const { ticket, mentionedUserIds } = await prisma.$transaction(async (tx) => {
    const board = await assertBoardAccess(auth.user, boardId, 'view', tx)
    if (board.archived) {
      throw errInvalidOperation()
    }
    await assertBoardAssignee(tx, boardId, assigneeId)
    const ids = await assertTagIdsInBoard(tx, boardId, tagIds)

    const number = await nextTicketNumber(tx, boardId)
    const lane = await tx.ticket.aggregate({ where: { boardId, status }, _max: { order: true } })

    const candidates = await getBoardMentionCandidates(boardId, tx)
    const mentionedUserIds = resolveMentionUserIds(extractMentionEmails(content ?? ''), candidates)

    const created = await tx.ticket.create({
      data: {
        boardId,
        title,
        content,
        status,
        priority,
        dueDate: dateOnlyToUtc(dueDate),
        completedAt: status === 'done' ? nowDate() : null,
        createdById: auth.user.id,
        assigneeId: assigneeId ?? null,
        number,
        mentionedUserIds,
        tags: { create: ids.map((tagId) => ({ tagId })) },
        order: nextOrder(lane._max.order === null ? [] : [lane._max.order]),
      },
      select: { id: true, title: true, number: true, board: { select: { key: true } } },
    })

    return {
      ticket: {
        id: created.id,
        title: created.title,
        displayId: ticketDisplayId({ key: created.board.key, number: created.number }),
      },
      mentionedUserIds,
    }
  })

  await notifyMention({
    ticketId: ticket.id,
    displayId: ticket.displayId,
    ticketTitle: ticket.title,
    fromUserId: auth.user.id,
    toUserIds: mentionedUserIds,
  })

  logger.info({ userId: auth.user.id, ticket }, 'mcp ticket created')
  return ticket
}

export type McpUpdateTicketInput = {
  title?: string
  content?: string
  priority?: TicketPriority
  dueDate?: string | null
  assigneeId?: string | null
  tagIds?: string[]
  status?: TicketStatus
}

/**
 * MCP経由のチケット更新(フィールド編集 + ステータス変更)。
 * メンバーは他人が担当のチケットを更新できない(canMcpUpdateTicket)という追加制限を挟む。
 */
export const updateTicketForMcp = async (
  auth: ResourceAuth,
  ticketIdOrDisplayId: string,
  input: McpUpdateTicketInput,
) => {
  const id = await resolveTicketId(auth, ticketIdOrDisplayId)
  const { assigneeId, tagIds, dueDate, status, ...rest } = input

  const { ticket, addedMentionUserIds } = await prisma.$transaction(async (tx) => {
    const access = await assertTicketAccess(auth.user, id, 'edit', tx)
    if (!canMcpUpdateTicket({ userId: auth.user.id, boardRole: access.boardRole, assigneeId: access.assigneeId })) {
      throw errInvalidOperation()
    }

    if (assigneeId !== undefined) {
      await assertBoardAssignee(tx, access.boardId, assigneeId)
    }
    const ids = tagIds !== undefined ? await assertTagIdsInBoard(tx, access.boardId, tagIds) : undefined

    let mentionedUserIds: string[] | undefined
    let addedMentionUserIds: string[] = []
    if (rest.content !== undefined) {
      const before = await tx.ticket.findUniqueOrThrow({ where: { id }, select: { mentionedUserIds: true } })
      const candidates = await getTicketMentionCandidates(access, tx)
      mentionedUserIds = resolveMentionUserIds(extractMentionEmails(rest.content ?? ''), candidates)
      addedMentionUserIds = mentionedUserIds.filter((userId) => !before.mentionedUserIds.includes(userId))
    }

    const updated = await tx.ticket.update({
      where: { id },
      data: {
        ...rest,
        ...(dueDate !== undefined && { dueDate: dateOnlyToUtc(dueDate) }),
        ...(assigneeId !== undefined && { assigneeId: assigneeId ?? null }),
        mentionedUserIds,
      },
      select: { id: true, title: true, number: true, status: true, board: { select: { key: true } } },
    })
    if (ids) {
      await syncTicketTags(tx, id, ids)
    }

    const moved =
      status !== undefined && status !== access.status ? await moveTicketToLane(tx, { access, status }) : null

    return {
      ticket: { ...updated, status: moved?.status ?? updated.status },
      addedMentionUserIds,
    }
  })

  const displayId = ticketDisplayId({ key: ticket.board.key, number: ticket.number })
  await notifyMention({
    ticketId: id,
    displayId,
    ticketTitle: ticket.title,
    fromUserId: auth.user.id,
    toUserIds: addedMentionUserIds,
  })

  logger.info({ userId: auth.user.id, id }, 'mcp ticket updated')
  return { id: ticket.id, displayId, title: ticket.title, status: ticket.status }
}

/**
 * MCP経由のチケット削除。オーナー・メンバーいずれも自分が作成したチケットのみ削除できる
 * (canMcpDeleteTicket)。Web版の canDelete(owner または作成者)より厳しい。
 */
export const deleteTicketForMcp = async (auth: ResourceAuth, ticketIdOrDisplayId: string) => {
  const id = await resolveTicketId(auth, ticketIdOrDisplayId)

  await prisma.$transaction(async (tx) => {
    const access = await assertTicketAccess(auth.user, id, 'delete', tx)
    if (!canMcpDeleteTicket({ userId: auth.user.id, createdById: access.createdById })) {
      throw errInvalidOperation()
    }
    await tx.ticket.delete({ where: { id } })
  })

  logger.info({ userId: auth.user.id, id }, 'mcp ticket deleted')
  return { id }
}

/**
 * コメント投稿。MCP限定の追加制限は無く、Web版の addTicketComment と同じ権限判定を使う。
 */
export const addTicketCommentForMcp = async (
  auth: ResourceAuth,
  ticketIdOrDisplayId: string,
  content: string,
  type?: TicketCommentType | null,
  parentId?: string | null,
) => {
  const ticketId = await resolveTicketId(auth, ticketIdOrDisplayId)

  const { comment, mentionedUserIds, ticket } = await prisma.$transaction(async (tx) => {
    const access = await assertTicketAccess(auth.user, ticketId, 'edit', tx)
    if (parentId) {
      await assertReplyTarget(tx, ticketId, parentId)
    }

    const candidates = await getTicketMentionCandidates(access, tx)
    const mentionedUserIds = resolveMentionUserIds(extractMentionEmails(content), candidates)

    const comment = await tx.ticketComment.create({
      data: { ticketId, authorId: auth.user.id, content, type, parentId, mentionedUserIds },
      select: { id: true },
    })

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
    fromUserId: auth.user.id,
    toUserIds: mentionedUserIds,
  })

  logger.info({ userId: auth.user.id, ticketId, commentId: comment.id }, 'mcp ticket comment added')
  return { id: comment.id }
}

/**
 * コメント更新(投稿者本人のみ)。MCP限定の追加制限は無く、Web版の updateTicketComment と同じ。
 */
export const updateTicketCommentForMcp = async (auth: ResourceAuth, commentId: string, content: string) => {
  const { addedMentionUserIds, ticketId, ticket } = await prisma.$transaction(async (tx) => {
    const target = await tx.ticketComment.findUnique({
      where: { id: commentId },
      select: {
        ticketId: true,
        authorId: true,
        mentionedUserIds: true,
        ticket: { select: { number: true, title: true, board: { select: { key: true } } } },
      },
    })
    if (!target || target.authorId !== auth.user.id) {
      throw errInvalidOperation()
    }

    const access = await assertTicketAccess(auth.user, target.ticketId, 'edit', tx)
    const candidates = await getTicketMentionCandidates(access, tx)
    const mentionedUserIds = resolveMentionUserIds(extractMentionEmails(content), candidates)

    await tx.ticketComment.update({ where: { id: commentId }, data: { content, mentionedUserIds } })
    await tx.ticket.update({ where: { id: target.ticketId }, data: { updatedAt: new Date() } })
    return {
      mentionedUserIds,
      addedMentionUserIds: mentionedUserIds.filter((userId) => !target.mentionedUserIds.includes(userId)),
      ticketId: target.ticketId,
      ticket: target.ticket,
    }
  })

  await notifyMention({
    ticketId,
    displayId: ticketDisplayId({ key: ticket.board.key, number: ticket.number }),
    ticketTitle: ticket.title,
    commentId,
    commentContent: content,
    fromUserId: auth.user.id,
    toUserIds: addedMentionUserIds,
  })

  logger.info({ userId: auth.user.id, commentId }, 'mcp ticket comment updated')
  return { id: commentId }
}

/**
 * コメント削除(投稿者本人、またはチケットを削除できる権限を持つ人)。
 * MCP限定の追加制限(canMcpDeleteTicket)は挟まず、Web版の deleteTicketComment と同じ。
 */
export const deleteTicketCommentForMcp = async (auth: ResourceAuth, commentId: string) => {
  await prisma.$transaction(async (tx) => {
    const target = await tx.ticketComment.findUnique({
      where: { id: commentId },
      select: { ticketId: true, authorId: true },
    })
    if (!target) {
      throw errInvalidOperation()
    }

    const access = await assertTicketAccess(auth.user, target.ticketId, 'edit', tx)
    if (target.authorId !== auth.user.id && !access.canDelete) {
      throw errInvalidOperation()
    }

    await tx.ticketComment.delete({ where: { id: commentId } })
  })

  logger.info({ userId: auth.user.id, commentId }, 'mcp ticket comment deleted')
  return { id: commentId }
}
