/**
 * resolveBoardId は UUID とボードキー(例: ABC)を取り違えないことが要点なので、
 * prisma を差し替えて「キーの時だけ引く」判定と、未知のキーの扱いを検証する。
 */

import { getBoardForMcp, listBoardsForMcp, resolveBoardId } from '@/lib/mcp/mcp-board'
import type { ResourceAuth } from '@/lib/oauth/oauth-resource'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { board: { findUnique: vi.fn() } },
}))

vi.mock('@/lib/board/board-access', () => ({
  assertBoardAccess: vi.fn(),
}))

vi.mock('@/lib/board/board', () => ({
  countTicketsByBoard: vi.fn(),
  listAccessibleBoards: vi.fn(),
}))

vi.mock('@/lib/board/board-member', () => ({
  getBoardMemberUsers: vi.fn(),
}))

vi.mock('@/lib/board/tag', () => ({
  listBoardTags: vi.fn(),
}))

const { assertBoardAccess } = await import('@/lib/board/board-access')
const { countTicketsByBoard, listAccessibleBoards } = await import('@/lib/board/board')
const { getBoardMemberUsers } = await import('@/lib/board/board-member')
const { listBoardTags } = await import('@/lib/board/tag')

const auth: ResourceAuth = {
  user: { id: 'u1', name: 'tester', email: 'test@example.com', role: null },
  scopes: ['mcp'],
  kind: 'oauth',
  clientId: 'test-client',
}

const boardId = '019e0000-0000-7000-8000-000000000001'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveBoardId', () => {
  it('ボードキーは Board.key から id を引く', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValueOnce({ id: boardId } as never)

    expect(await resolveBoardId('ABC')).toBe(boardId)
    expect(prisma.board.findUnique).toHaveBeenCalledWith({ where: { key: 'ABC' }, select: { id: true } })
  })

  it('UUID はキーとして扱わず、そのまま返す', async () => {
    expect(await resolveBoardId(boardId)).toBe(boardId)
    expect(prisma.board.findUnique).not.toHaveBeenCalled()
  })

  it('キーの形をしていない文字列は引かずにそのまま返す(小文字・記号など)', async () => {
    expect(await resolveBoardId('abc')).toBe('abc')
    expect(await resolveBoardId('A')).toBe('A')
    expect(prisma.board.findUnique).not.toHaveBeenCalled()
  })

  it('存在しないキーはエラーにする', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValueOnce(null as never)

    await expect(resolveBoardId('NOPE')).rejects.toThrow()
  })

  it('allowUnknownKey では存在しないキーもエラーにせずそのまま返す', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValueOnce(null as never)

    expect(await resolveBoardId('NOPE', { allowUnknownKey: true })).toBe('NOPE')
  })
})

describe('listBoardsForMcp', () => {
  it('アクセスできるボードを MCP 向けの項目だけにして返す', async () => {
    vi.mocked(listAccessibleBoards).mockResolvedValueOnce([
      {
        id: boardId,
        kind: 'team',
        key: 'ABC',
        name: 'テストボード',
        description: '説明',
        archived: false,
        role: 'owner',
        via: 'member',
      },
    ])

    expect(await listBoardsForMcp(auth, { includeArchived: true })).toEqual([
      {
        id: boardId,
        key: 'ABC',
        name: 'テストボード',
        description: '説明',
        kind: 'team',
        archived: false,
        role: 'owner',
        via: 'member',
      },
    ])
    expect(listAccessibleBoards).toHaveBeenCalledWith('u1', { includeArchived: true })
  })
})

describe('getBoardForMcp', () => {
  it('担当者候補・タグ・チケット件数をまとめて返す', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValueOnce({
      key: 'ABC',
      name: 'テストボード',
      description: null,
    } as never)
    vi.mocked(assertBoardAccess).mockResolvedValueOnce({
      boardId,
      kind: 'team',
      role: 'member',
      via: 'member',
      archived: false,
    })
    vi.mocked(getBoardMemberUsers).mockResolvedValueOnce([
      {
        id: 'u1',
        name: 'tester',
        email: 'test@example.com',
        image: 'https://example.com/a.png',
        isAgent: false,
        role: 'member',
        via: 'member',
      },
    ])
    vi.mocked(listBoardTags).mockResolvedValueOnce([{ id: 'tag-1', boardId, name: 'bug', color: 'red', order: 1 }])
    vi.mocked(countTicketsByBoard).mockResolvedValueOnce({ [boardId]: { todo: 2 } })

    const board = await getBoardForMcp(auth, boardId)

    expect(board).toEqual({
      id: boardId,
      key: 'ABC',
      name: 'テストボード',
      description: '',
      kind: 'team',
      archived: false,
      role: 'member',
      // アバターは MCP では使わないので落とす
      members: [{ id: 'u1', name: 'tester', email: 'test@example.com', isAgent: false, role: 'member', via: 'member' }],
      tags: [{ id: 'tag-1', name: 'bug', color: 'red' }],
      ticketCounts: { todo: 2 },
    })
    expect(assertBoardAccess).toHaveBeenCalledWith(auth.user, boardId, 'view')
  })
})
