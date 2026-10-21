/** ボードノートの削除済みの一覧(最後の削除の版を、その時点の区分で出す) */

import { listDeletedBoardNotes } from '@/lib/board-note/board-note-revision'
import { assertBoardAccess } from '@/lib/board/board-access'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    boardNote: ['findMany'],
    boardNoteRevision: ['findMany'],
  }),
)
vi.mock('@/lib/board/board-access', () => ({ assertBoardAccess: vi.fn() }))

const actor = { id: 'user-1' }
const BOARD_ID = 'board-1'

const revision = (id: string, noteId: string, kind: 'knowledge' | 'memory') => ({
  id,
  noteId,
  action: 'deleted',
  kind,
  name: noteId,
  description: '説明',
  via: 'web',
  createdAt: new Date(),
  actor: { name: '利用者', isAgent: false },
  ticket: null,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertBoardAccess).mockResolvedValue({} as never)
  vi.mocked(prisma.boardNote.findMany).mockResolvedValue([])
})

describe('listDeletedBoardNotes', () => {
  it('ノートごとに最後の削除を選んでから区分で絞る(前の区分での古い削除は出さない)', async () => {
    // distinct で note-x の最後の削除(memory)だけが返る
    vi.mocked(prisma.boardNoteRevision.findMany).mockResolvedValue([
      revision('rev-b', 'note-x', 'memory'),
      revision('rev-c', 'note-y', 'knowledge'),
    ] as never)

    const knowledge = await listDeletedBoardNotes(actor, BOARD_ID, 'knowledge')

    expect(knowledge.map(({ id }) => id)).toEqual(['rev-c'])
    expect(vi.mocked(prisma.boardNoteRevision.findMany).mock.calls[0][0]).toMatchObject({
      where: { boardId: BOARD_ID, action: 'deleted' },
      distinct: ['noteId'],
    })
    expect(vi.mocked(prisma.boardNoteRevision.findMany).mock.calls[0][0]?.where).not.toHaveProperty('kind')
  })

  it('復元されて今あるノートは出さず、一覧には本文を含めない', async () => {
    vi.mocked(prisma.boardNoteRevision.findMany).mockResolvedValue([
      revision('rev-a', 'note-a', 'memory'),
      revision('rev-b', 'note-b', 'memory'),
    ] as never)
    vi.mocked(prisma.boardNote.findMany).mockResolvedValue([{ id: 'note-a' }] as never)

    const memory = await listDeletedBoardNotes(actor, BOARD_ID, 'memory')

    expect(memory.map(({ noteId }) => noteId)).toEqual(['note-b'])
    expect(vi.mocked(prisma.boardNoteRevision.findMany).mock.calls[0][0]?.select).not.toHaveProperty('content')
  })
})
