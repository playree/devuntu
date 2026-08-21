import type { TicketPriority, TicketStatus } from '@/generated/prisma/enums'
import { assertTicketAccess, findTicketIdByDisplayId, getAccessibleBoardIds } from '@/lib/board'
import { errInvalidOperation } from '@/lib/error'
import type { ResourceAuth } from '@/lib/oauth/oauth-resource'
import { prisma } from '@/lib/prisma'
import { makeUrl } from '@/lib/server-utils'
import { buildTicketWhere, parseTicketDisplayId, ticketDisplayId, ticketListOrderBy, ticketShortPath } from '@/lib/task'

const resolveTicketId = async (auth: ResourceAuth, ticketIdOrDisplayId: string): Promise<string> => {
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
        select: { content: true, author: { select: { name: true } }, createdAt: true },
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
      authorName: comment.author?.name ?? '',
      content: comment.content,
      createdAt: comment.createdAt,
    })),
  }
}

export type McpTicketSearchInput = {
  keyword?: string
  status?: TicketStatus[]
  priority?: TicketPriority[]
  tags?: string[]
  boardId?: string
  limit?: number
}

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
      assignee: null,
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
