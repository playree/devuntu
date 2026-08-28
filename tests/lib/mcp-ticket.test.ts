/**
 * updateTicketCommentForMcp はコメント本文の更新に加えて、同一トランザクション内で
 * 親チケットの updatedAt も更新する必要がある(searchTicketsForMcp が updatedAt 降順で
 * 一覧を返すため)。この検証には prisma.$transaction にフェイクの tx を渡す必要があるので、
 * vitest.setup.ts のグローバルモックをこのファイル内で上書きする。
 */

import type { TicketAccess } from '@/lib/board/board'
import { updateTicketCommentForMcp } from '@/lib/mcp/mcp-ticket'
import { notifyMention } from '@/lib/notify/notify-mention'
import type { ResourceAuth } from '@/lib/oauth/oauth-resource'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(fakeTx)) },
}))

vi.mock('@/lib/board/board', () => ({
  assertTicketAccess: vi.fn(),
  getTicketMentionCandidates: vi.fn(),
}))

vi.mock('@/lib/notify/notify-mention', () => ({
  notifyMention: vi.fn(),
}))

const ticketAccess: TicketAccess = {
  canView: true,
  canEdit: true,
  canDelete: true,
  ticketId: 'ticket-1',
  boardId: 'board-1',
  boardKind: 'team',
  createdById: 'u1',
  assigneeId: null,
  status: 'todo',
  boardRole: 'member',
}

const fakeTicket = { number: 1, title: 'テストチケット', board: { key: 'TST' } }

const fakeTx = {
  ticketComment: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  ticket: {
    update: vi.fn(),
  },
}

const auth: ResourceAuth = {
  user: { id: 'u1', name: 'tester', email: 'test@example.com', role: null },
  scopes: ['mcp'],
  kind: 'oauth',
  clientId: 'test-client',
}

beforeEach(async () => {
  vi.clearAllMocks()
  fakeTx.ticketComment.findUnique.mockResolvedValue({
    ticketId: 'ticket-1',
    authorId: 'u1',
    mentionedUserIds: [],
    ticket: fakeTicket,
  })

  const { assertTicketAccess, getTicketMentionCandidates } = await import('@/lib/board/board')
  vi.mocked(assertTicketAccess).mockResolvedValue(ticketAccess)
  vi.mocked(getTicketMentionCandidates).mockResolvedValue([])
})

describe('updateTicketCommentForMcp', () => {
  it('コメント更新と同じトランザクションで親チケットの updatedAt を更新する', async () => {
    await updateTicketCommentForMcp(auth, 'comment-1', '更新後の本文')

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(fakeTx.ticketComment.update).toHaveBeenCalledWith({
      where: { id: 'comment-1' },
      data: { content: '更新後の本文', mentionedUserIds: [] },
    })
    expect(fakeTx.ticket.update).toHaveBeenCalledWith({
      where: { id: 'ticket-1' },
      data: { updatedAt: expect.any(Date) },
    })
    expect(notifyMention).toHaveBeenCalled()
  })
})
