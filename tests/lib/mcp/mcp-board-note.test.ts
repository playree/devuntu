/** ボードノートの MCP ツール(名前での upsert・経路の受け渡し・索引の形) */

import {
  createBoardNote,
  deleteBoardNote,
  findBoardNoteIdByName,
  getBoardNotesByName,
  listBoardNotes,
  updateBoardNote,
} from '@/lib/board-note/board-note'
import { assertBoardAccess } from '@/lib/board/board-access'
import { deleteBoardNoteForMcp, getBoardNotesForMcp, saveBoardNoteForMcp } from '@/lib/mcp/mcp-board-note'
import { resolveTicketId } from '@/lib/mcp/mcp-ticket'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { agentAuth, oauthAuth } from '../../helpers/resource-auth'

vi.mock('@/lib/prisma', async () => (await import('../../helpers/prisma')).mockPrisma({ board: ['findUnique'] }))
vi.mock('@/lib/board/board-access', () => ({ assertBoardAccess: vi.fn() }))
vi.mock('@/lib/mcp/mcp-ticket', () => ({ resolveTicketId: vi.fn() }))
vi.mock('@/lib/board-note/board-note', async (importOriginal) => ({
  errBoardNoteConflict: (await importOriginal<typeof import('@/lib/board-note/board-note')>()).errBoardNoteConflict,
  createBoardNote: vi.fn(),
  deleteBoardNote: vi.fn(),
  findBoardNoteIdByName: vi.fn(),
  getBoardNotesByName: vi.fn(),
  listBoardNotes: vi.fn(),
  updateBoardNote: vi.fn(),
}))

const BOARD_ID = '0195c1e0-0000-7000-8000-0000000000bb'
const UPDATED_AT = new Date('2026-10-01T00:00:00.000Z')
const human = oauthAuth()
const agent = agentAuth()

const WRITE_RESULT = { result: 'created' as const, id: 'note-1', name: 'migrate-gotcha', updatedAt: UPDATED_AT }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertBoardAccess).mockResolvedValue({} as never)
  vi.mocked(createBoardNote).mockResolvedValue(WRITE_RESULT)
  vi.mocked(updateBoardNote).mockResolvedValue({ ...WRITE_RESULT, result: 'updated' })
  vi.mocked(resolveTicketId).mockResolvedValue('ticket-1')
})

describe('saveBoardNoteForMcp', () => {
  it('同じ名前が無ければ、既定の区分(memory)・種別(insight)で作る', async () => {
    vi.mocked(findBoardNoteIdByName).mockResolvedValue(null)

    const result = await saveBoardNoteForMcp(agent, {
      boardId: BOARD_ID,
      name: 'migrate-gotcha',
      description: '説明',
      content: '本文',
      ticketId: 'ABC-1',
    })

    expect(result).toEqual({ result: 'created', name: 'migrate-gotcha', updatedAt: UPDATED_AT })
    expect(assertBoardAccess).toHaveBeenCalledWith(agent.user, BOARD_ID, 'write')
    expect(createBoardNote).toHaveBeenCalledWith(
      agent.user,
      { via: 'mcp', agent: true, userApproved: false },
      BOARD_ID,
      { kind: 'memory', type: 'insight', name: 'migrate-gotcha', description: '説明', content: '本文' },
      { ticketId: 'ticket-1' },
    )
  })

  it('作るときは description と content が要る', async () => {
    vi.mocked(findBoardNoteIdByName).mockResolvedValue(null)
    await expect(saveBoardNoteForMcp(human, { boardId: BOARD_ID, name: 'x', content: '本文' })).rejects.toThrow(
      /description and content are required/,
    )
    expect(createBoardNote).not.toHaveBeenCalled()
  })

  it('無い名前の改名は作成と取り違えないよう弾く', async () => {
    vi.mocked(findBoardNoteIdByName).mockResolvedValue(null)
    await expect(
      saveBoardNoteForMcp(human, { boardId: BOARD_ID, name: 'x', newName: 'y', description: 'd', content: 'c' }),
    ).rejects.toThrow(/No note named x/)
  })

  it('同じ名前があれば渡した項目だけ更新し、同意の申告と改名・競合検出を渡す', async () => {
    vi.mocked(findBoardNoteIdByName).mockResolvedValue('note-1')

    await saveBoardNoteForMcp(human, {
      boardId: BOARD_ID,
      name: 'migrate-gotcha',
      kind: 'knowledge',
      newName: 'migrate-shadow-db',
      expectedUpdatedAt: UPDATED_AT.toISOString(),
      userApproved: true,
    })

    expect(updateBoardNote).toHaveBeenCalledWith(
      human.user,
      { via: 'mcp', agent: false, userApproved: true },
      'note-1',
      { kind: 'knowledge', name: 'migrate-shadow-db' },
      { expectedUpdatedAt: UPDATED_AT.toISOString(), ticketId: null },
    )
  })

  it('書き込めないボードでは名前の有無を引く前に止める', async () => {
    vi.mocked(assertBoardAccess).mockRejectedValue(new Error('denied'))
    await expect(saveBoardNoteForMcp(human, { boardId: BOARD_ID, name: 'x' })).rejects.toThrow()
    expect(findBoardNoteIdByName).not.toHaveBeenCalled()
  })
})

describe('deleteBoardNoteForMcp', () => {
  it('無い名前は deleted: false を返す(繰り返しても同じ結果)', async () => {
    vi.mocked(findBoardNoteIdByName).mockResolvedValue(null)
    expect(await deleteBoardNoteForMcp(human, { boardId: BOARD_ID, name: 'x' })).toEqual({ deleted: false })
    expect(deleteBoardNote).not.toHaveBeenCalled()
  })

  it('ある名前は経路を添えて消す', async () => {
    vi.mocked(findBoardNoteIdByName).mockResolvedValue('note-1')
    expect(await deleteBoardNoteForMcp(agent, { boardId: BOARD_ID, name: 'x' })).toEqual({ deleted: true })
    expect(deleteBoardNote).toHaveBeenCalledWith(
      agent.user,
      { via: 'mcp', agent: true, userApproved: false },
      'note-1',
      { ticketId: null },
    )
  })
})

describe('getBoardNotesForMcp', () => {
  it('names を渡すと本文を返し、見つからない名前は notFound に返す', async () => {
    vi.mocked(getBoardNotesByName).mockResolvedValue({
      notes: [
        {
          name: 'a',
          kind: 'memory',
          type: 'insight',
          description: 'd',
          content: 'c',
          updatedAt: UPDATED_AT,
          updatedBy: { name: 'AI', isAgent: true },
        },
      ],
      notFound: ['b'],
    } as never)

    expect(await getBoardNotesForMcp(human, { boardId: BOARD_ID, names: ['a', 'b'] })).toEqual({
      notes: [
        {
          name: 'a',
          kind: 'memory',
          type: 'insight',
          description: 'd',
          content: 'c',
          updatedAt: UPDATED_AT,
          updatedByName: 'AI',
        },
      ],
      notFound: ['b'],
    })
  })

  it('names が無ければ索引と同じ形で、上限で切らずに返す', async () => {
    vi.mocked(listBoardNotes).mockResolvedValue([
      { kind: 'knowledge', name: 'k', description: 'ナレッジ' },
      { kind: 'memory', name: 'm', description: 'メモリ' },
    ] as never)

    expect(await getBoardNotesForMcp(human, { boardId: BOARD_ID, keyword: 'deploy' })).toEqual({
      boardKnowledge: ['k: ナレッジ'],
      boardMemory: ['m: メモリ'],
      total: 2,
    })
    expect(listBoardNotes).toHaveBeenCalledWith(human.user, BOARD_ID, { kind: undefined, keyword: 'deploy' })
  })
})

describe('saveBoardNoteForMcp の競合検出', () => {
  it('読んだ後に削除されたノートは作り直さず競合として返す', async () => {
    vi.mocked(findBoardNoteIdByName).mockResolvedValue(null)

    await expect(
      saveBoardNoteForMcp(human, {
        boardId: BOARD_ID,
        name: 'gone',
        description: 'd',
        content: 'c',
        expectedUpdatedAt: UPDATED_AT.toISOString(),
      }),
    ).rejects.toMatchObject({ errorType: 'BOARD_NOTE_CONFLICT' })
    expect(createBoardNote).not.toHaveBeenCalled()
  })
})
