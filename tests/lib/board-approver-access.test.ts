/**
 * ボードのメンバーでない承認者の閲覧経路
 *
 * 承認者は担当エージェントのチケットをボード外から確認できるので、表示IDの解決と
 * 添付の配信もそれに合わせる。一方で、同じボードの無関係なチケットまで見えてはいけない。
 */

import { isAgentApprover } from '@/lib/agent/agent-approver'
import { canViewAttachment, findTicketIdByDisplayId } from '@/lib/board/board'
import { prisma } from '@/lib/prisma'
import { toUploadUrl } from '@/lib/storage/upload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/agent/agent-approver', () => ({
  approvableAgentWhere: (userId: string) => ({ isAgent: true, approver: userId }),
  isAgentApprover: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  isUniqueViolation: () => false,
  prisma: {
    board: { findUnique: vi.fn() },
    ticket: { findUnique: vi.fn(), count: vi.fn() },
  },
}))

const KEY = '019eef64-6cc1-78f1-8f50-1ef86986289a.webp'
const actor = { id: 'u1', role: 'user' }

type FindArgs = { where: Record<string, unknown>; select?: Record<string, unknown> }

/** ボード `ABC`(b1)。isMember でメンバーかどうかを切り替える */
const mockBoard = (isMember: boolean) => {
  vi.mocked(prisma.board.findUnique).mockImplementation((async ({ where, select }: FindArgs) => {
    if (where.key) {
      return where.key === 'ABC' ? { id: 'b1' } : null
    }
    if (select?.members) {
      return { id: 'b1', kind: 'team', archived: false, members: isMember ? [{ role: 'member' }] : [], groups: [] }
    }
    return { kind: 'team', archived: false }
  }) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.ticket.findUnique).mockImplementation((async ({ where }: FindArgs) =>
    where.boardId_number
      ? { id: 't1' }
      : {
          id: 't1',
          boardId: 'b1',
          createdById: 'u2',
          assigneeId: 'agent-1',
          status: 'todo',
          assignee: { isAgent: true },
        }) as never)
})

describe('findTicketIdByDisplayId', () => {
  it('ボードのメンバーなら引ける', async () => {
    mockBoard(true)
    expect(await findTicketIdByDisplayId(actor, 'ABC-1')).toBe('t1')
    expect(isAgentApprover).not.toHaveBeenCalled()
  })

  it('メンバーでなくても担当エージェントの承認者なら引ける', async () => {
    mockBoard(false)
    vi.mocked(isAgentApprover).mockResolvedValue(true)
    expect(await findTicketIdByDisplayId(actor, 'ABC-1')).toBe('t1')
  })

  it('メンバーでも承認者でもなければ未存在と同じく null', async () => {
    mockBoard(false)
    vi.mocked(isAgentApprover).mockResolvedValue(false)
    expect(await findTicketIdByDisplayId(actor, 'ABC-1')).toBeNull()
  })
})

describe('canViewAttachment', () => {
  it('ボードに属さない添付は誰でも読める', async () => {
    expect(await canViewAttachment(actor, { key: KEY, boardId: null })).toBe(true)
    expect(prisma.board.findUnique).not.toHaveBeenCalled()
  })

  it('ボードのメンバーなら読める', async () => {
    mockBoard(true)
    expect(await canViewAttachment(actor, { key: KEY, boardId: 'b1' })).toBe(true)
    expect(prisma.ticket.count).not.toHaveBeenCalled()
  })

  it('メンバーでなければ、承認対象のチケットから参照されている添付だけを許す', async () => {
    mockBoard(false)
    vi.mocked(prisma.ticket.count).mockResolvedValue(1)
    expect(await canViewAttachment(actor, { key: KEY, boardId: 'b1' })).toBe(true)

    const url = toUploadUrl(KEY)
    expect(prisma.ticket.count).toHaveBeenCalledWith({
      where: {
        boardId: 'b1',
        assignee: { isAgent: true, approver: 'u1' },
        OR: [{ content: { contains: url } }, { comments: { some: { content: { contains: url } } } }],
      },
    })
  })

  it('承認対象のチケットから参照されていなければ読めない', async () => {
    mockBoard(false)
    vi.mocked(prisma.ticket.count).mockResolvedValue(0)
    expect(await canViewAttachment(actor, { key: KEY, boardId: 'b1' })).toBe(false)
  })
})
