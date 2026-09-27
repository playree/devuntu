/**
 * searchTicketsForMcp の boardId 指定は、未知のボードキーとアクセス外のボードで
 * 応答が変わってはいけない(変わるとキーの存在を応答差から判定できる)。
 * prisma と認可の問い合わせだけ差し替え、buildTicketWhere は実物を通して where を確かめる。
 */

import { searchTicketsForMcp } from '@/lib/mcp/mcp-ticket'
import type { ResourceAuth } from '@/lib/oauth/oauth-resource'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { board: { findUnique: vi.fn() }, ticket: { findMany: vi.fn() } },
}))

vi.mock('@/lib/board/board-access', () => ({
  getAccessibleBoardIds: vi.fn(),
}))

vi.mock('@/lib/notify/notify-trigger', () => ({
  enqueueTicketCommented: vi.fn(),
  enqueueTicketCreated: vi.fn(),
  enqueueTicketUpdated: vi.fn(),
}))

const { getAccessibleBoardIds } = await import('@/lib/board/board-access')

const auth: ResourceAuth = {
  user: { id: 'u1', name: 'tester', email: 'test@example.com', role: null },
  scopes: ['mcp'],
  kind: 'oauth',
  clientId: 'test-client',
}

const accessibleBoardId = '019e0000-0000-7000-8000-000000000001'
const hiddenBoardId = '019e0000-0000-7000-8000-000000000002'

/** 直近の findMany に渡された可視スコープの条件(buildTicketWhere が AND の先頭に積む) */
const scopeOfLastSearch = () => {
  const where = vi.mocked(prisma.ticket.findMany).mock.calls.at(-1)?.[0]?.where as { AND: unknown[] }
  return where.AND[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAccessibleBoardIds).mockResolvedValue([accessibleBoardId])
  vi.mocked(prisma.ticket.findMany).mockResolvedValue([] as never)
})

describe('searchTicketsForMcp', () => {
  it('未知のボードキーでもエラーにせず 0 件になる条件で引く', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValueOnce(null as never)

    expect(await searchTicketsForMcp(auth, { boardId: 'NOPE' })).toEqual([])
    expect(scopeOfLastSearch()).toEqual({ boardId: { in: [] } })
  })

  it('存在するがアクセスできないボードキーも未知のキーと同じ条件になる', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValueOnce({ id: hiddenBoardId } as never)

    expect(await searchTicketsForMcp(auth, { boardId: 'HIDDEN' })).toEqual([])
    expect(scopeOfLastSearch()).toEqual({ boardId: { in: [] } })
  })

  it('アクセスできるボードキーはそのボードに絞って引く', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValueOnce({ id: accessibleBoardId } as never)

    await searchTicketsForMcp(auth, { boardId: 'ABC' })

    expect(scopeOfLastSearch()).toEqual({ boardId: { in: [accessibleBoardId] } })
  })
})
