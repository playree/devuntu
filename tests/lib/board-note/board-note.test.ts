/**
 * ボードノートの書き込み(サーバー専用)の単体テスト
 *
 * 経路ごとのナレッジの書き込み可否、件数の上限、競合の検出、版の記録と上限、復元を、
 * prisma を差し替えて確かめる。
 */

import {
  createBoardNote,
  deleteBoardNote,
  findBoardNoteIndex,
  restoreBoardNoteRevision,
  updateBoardNote,
} from '@/lib/board-note/board-note'
import {
  BOARD_NOTE_CONFLICT,
  BOARD_NOTE_KNOWLEDGE_DENIED,
  BOARD_NOTE_LIMIT_REACHED,
  type BoardNoteSnapshot,
  type BoardNoteWriter,
  DUPLICATED_BOARD_NOTE_NAME,
  MCP_MEMORY_INDEX_LIMIT,
} from '@/lib/board-note/board-note-rule'
import { assertBoardAccess } from '@/lib/board/board-access'
import { errInvalidOperation, VALIDATION_ERROR } from '@/lib/error'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const MEMORY_MAX = 3
const KNOWLEDGE_MAX = 2
const REVISION_MAX = 5

vi.mock('@/lib/env-util', () => ({
  envu: {
    server: {
      get BOARD_MEMORY_MAX_COUNT() {
        return MEMORY_MAX
      },
      get BOARD_KNOWLEDGE_MAX_COUNT() {
        return KNOWLEDGE_MAX
      },
      get BOARD_NOTE_REVISION_MAX_PER_NOTE() {
        return REVISION_MAX
      },
    },
  },
}))

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    boardNote: ['findUnique', 'findUniqueOrThrow', 'findMany', 'create', 'update', 'delete', 'count'],
    boardNoteRevision: ['create', 'findMany', 'findUnique', 'deleteMany'],
    ticket: ['findFirst'],
  }),
)

vi.mock('@/lib/board/board-access', () => ({ assertBoardAccess: vi.fn() }))

const actor = { id: 'user-1' }
const BOARD_ID = 'board-1'
const NOTE_ID = 'note-1'
const UPDATED_AT = new Date('2026-10-01T00:00:00.000Z')

const WEB: BoardNoteWriter = { via: 'web' }
const AGENT: BoardNoteWriter = { via: 'mcp', agent: true, userApproved: false }
const HUMAN: BoardNoteWriter = { via: 'mcp', agent: false, userApproved: false }
const HUMAN_APPROVED: BoardNoteWriter = { via: 'mcp', agent: false, userApproved: true }

const snapshot = (override: Partial<BoardNoteSnapshot> = {}): BoardNoteSnapshot => ({
  kind: 'memory',
  name: 'migrate-gotcha',
  description: 'migrate dev が失敗する件',
  content: '本文',
  ...override,
})

const existing = (override: Partial<BoardNoteSnapshot> = {}) => ({
  ...snapshot(override),
  boardId: BOARD_ID,
  updatedAt: UPDATED_AT,
})

const errorTypeOf = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (e) {
    return (e as { errorType?: string }).errorType
  }
  throw new Error('not rejected')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertBoardAccess).mockResolvedValue({} as never)
  vi.mocked(prisma.boardNote.count).mockResolvedValue(0)
  vi.mocked(prisma.boardNote.create).mockResolvedValue({
    id: NOTE_ID,
    name: 'migrate-gotcha',
    updatedAt: UPDATED_AT,
  } as never)
  vi.mocked(prisma.boardNote.update).mockResolvedValue({
    id: NOTE_ID,
    name: 'migrate-gotcha',
    updatedAt: UPDATED_AT,
  } as never)
  vi.mocked(prisma.boardNoteRevision.findMany).mockResolvedValue([])
  vi.mocked(prisma.ticket.findFirst).mockResolvedValue({ id: 'ticket-1' } as never)
})

describe('createBoardNote', () => {
  it('メモリはエージェントでも作れ、経路とチケットを版に残す', async () => {
    const result = await createBoardNote(actor, AGENT, BOARD_ID, snapshot(), { ticketId: 'ticket-1' })

    expect(result).toMatchObject({ result: 'created', id: NOTE_ID })
    expect(assertBoardAccess).toHaveBeenCalledWith(actor, BOARD_ID, 'write', expect.anything())
    expect(vi.mocked(prisma.boardNote.create).mock.calls[0][0].data).toMatchObject({
      boardId: BOARD_ID,
      createdById: actor.id,
      updatedById: actor.id,
      updatedVia: 'mcp',
    })
    expect(vi.mocked(prisma.boardNoteRevision.create).mock.calls[0][0].data).toMatchObject({
      noteId: NOTE_ID,
      action: 'created',
      via: 'mcp',
      actorId: actor.id,
      ticketId: 'ticket-1',
      ...snapshot(),
    })
  })

  it('エージェントはナレッジを作れない', async () => {
    expect(await errorTypeOf(createBoardNote(actor, AGENT, BOARD_ID, snapshot({ kind: 'knowledge' })))).toBe(
      BOARD_NOTE_KNOWLEDGE_DENIED,
    )
    expect(prisma.boardNote.create).not.toHaveBeenCalled()
  })

  it('MCP の人の経路は同意の申告が無いとナレッジを作れない', async () => {
    expect(await errorTypeOf(createBoardNote(actor, HUMAN, BOARD_ID, snapshot({ kind: 'knowledge' })))).toBe(
      BOARD_NOTE_KNOWLEDGE_DENIED,
    )
    await expect(
      createBoardNote(actor, HUMAN_APPROVED, BOARD_ID, snapshot({ kind: 'knowledge' })),
    ).resolves.toMatchObject({ result: 'created' })
  })

  it('画面からはナレッジを作れる', async () => {
    await expect(createBoardNote(actor, WEB, BOARD_ID, snapshot({ kind: 'knowledge' }))).resolves.toMatchObject({
      result: 'created',
    })
  })

  it('区分ごとの件数の上限で止める', async () => {
    vi.mocked(prisma.boardNote.count).mockResolvedValue(MEMORY_MAX)
    expect(await errorTypeOf(createBoardNote(actor, WEB, BOARD_ID, snapshot()))).toBe(BOARD_NOTE_LIMIT_REACHED)

    vi.mocked(prisma.boardNote.count).mockResolvedValue(KNOWLEDGE_MAX)
    expect(await errorTypeOf(createBoardNote(actor, WEB, BOARD_ID, snapshot({ kind: 'knowledge' })))).toBe(
      BOARD_NOTE_LIMIT_REACHED,
    )
    expect(vi.mocked(prisma.boardNote.count).mock.calls.at(-1)?.[0]).toEqual({
      where: { boardId: BOARD_ID, kind: 'knowledge' },
    })
  })

  it('同じ名前は DUPLICATED_BOARD_NOTE_NAME にする', async () => {
    vi.mocked(prisma.boardNote.create).mockRejectedValue({ code: 'P2002' })
    expect(await errorTypeOf(createBoardNote(actor, WEB, BOARD_ID, snapshot()))).toBe(DUPLICATED_BOARD_NOTE_NAME)
  })

  it('メモリの本文の上限を超えると弾く', async () => {
    expect(await errorTypeOf(createBoardNote(actor, WEB, BOARD_ID, snapshot({ content: 'x'.repeat(4001) })))).toBe(
      VALIDATION_ERROR,
    )
  })

  it('別のボードのチケットは版に紐づけない', async () => {
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null)
    expect(await errorTypeOf(createBoardNote(actor, AGENT, BOARD_ID, snapshot(), { ticketId: 'other' }))).toBe(
      VALIDATION_ERROR,
    )
  })

  it('書き込めないボード(非メンバー・アーカイブ済み)では作らない', async () => {
    vi.mocked(assertBoardAccess).mockRejectedValue(errInvalidOperation())
    await expect(createBoardNote(actor, WEB, BOARD_ID, snapshot())).rejects.toThrow()
    expect(prisma.boardNote.create).not.toHaveBeenCalled()
  })
})

describe('updateBoardNote', () => {
  beforeEach(() => {
    vi.mocked(prisma.boardNote.findUnique).mockResolvedValue(existing() as never)
  })

  it('渡した項目だけを変え、変更後の全文を版に残す', async () => {
    const result = await updateBoardNote(actor, AGENT, NOTE_ID, { content: '新しい本文' })

    expect(result.result).toBe('updated')
    expect(vi.mocked(prisma.boardNote.update).mock.calls[0][0].data).toMatchObject({
      ...snapshot({ content: '新しい本文' }),
      updatedById: actor.id,
      updatedVia: 'mcp',
    })
    expect(vi.mocked(prisma.boardNoteRevision.create).mock.calls[0][0].data).toMatchObject({
      action: 'updated',
      ...snapshot({ content: '新しい本文' }),
    })
  })

  it('内容が変わらなければ更新も版も作らない', async () => {
    const result = await updateBoardNote(actor, AGENT, NOTE_ID, { content: '本文' })

    expect(result).toEqual({ result: 'unchanged', id: NOTE_ID, name: 'migrate-gotcha', updatedAt: UPDATED_AT })
    expect(prisma.boardNote.update).not.toHaveBeenCalled()
    expect(prisma.boardNoteRevision.create).not.toHaveBeenCalled()
  })

  it('読んだ後に更新されていれば BOARD_NOTE_CONFLICT', async () => {
    expect(
      await errorTypeOf(
        updateBoardNote(actor, WEB, NOTE_ID, { content: 'x' }, { expectedUpdatedAt: '2026-09-30T00:00:00.000Z' }),
      ),
    ).toBe(BOARD_NOTE_CONFLICT)
    await expect(
      updateBoardNote(actor, WEB, NOTE_ID, { content: 'x' }, { expectedUpdatedAt: UPDATED_AT.toISOString() }),
    ).resolves.toMatchObject({ result: 'updated' })
  })

  it('エージェントは昇格できず、ナレッジの更新もできない', async () => {
    expect(await errorTypeOf(updateBoardNote(actor, AGENT, NOTE_ID, { kind: 'knowledge' }))).toBe(
      BOARD_NOTE_KNOWLEDGE_DENIED,
    )
    vi.mocked(prisma.boardNote.findUnique).mockResolvedValue(existing({ kind: 'knowledge' }) as never)
    expect(await errorTypeOf(updateBoardNote(actor, AGENT, NOTE_ID, { content: 'x' }))).toBe(
      BOARD_NOTE_KNOWLEDGE_DENIED,
    )
    expect(await errorTypeOf(updateBoardNote(actor, AGENT, NOTE_ID, { kind: 'memory' }))).toBe(
      BOARD_NOTE_KNOWLEDGE_DENIED,
    )
    expect(prisma.boardNote.update).not.toHaveBeenCalled()
  })

  it('区分を変えるときは移し先の件数の上限を見る', async () => {
    vi.mocked(prisma.boardNote.count).mockResolvedValue(KNOWLEDGE_MAX)
    expect(await errorTypeOf(updateBoardNote(actor, HUMAN_APPROVED, NOTE_ID, { kind: 'knowledge' }))).toBe(
      BOARD_NOTE_LIMIT_REACHED,
    )
  })

  it('同じ区分のまま更新するときは件数を数えない(上限を下げた後も既存は直せる)', async () => {
    vi.mocked(prisma.boardNote.count).mockResolvedValue(MEMORY_MAX + 10)
    await expect(updateBoardNote(actor, WEB, NOTE_ID, { content: 'x' })).resolves.toMatchObject({ result: 'updated' })
    expect(prisma.boardNote.count).not.toHaveBeenCalled()
  })

  it('改名先が使われていれば DUPLICATED_BOARD_NOTE_NAME', async () => {
    vi.mocked(prisma.boardNote.update).mockRejectedValue({ code: 'P2002' })
    expect(await errorTypeOf(updateBoardNote(actor, WEB, NOTE_ID, { name: 'other' }))).toBe(DUPLICATED_BOARD_NOTE_NAME)
  })

  it('版数の上限を超えた古い版を消す', async () => {
    vi.mocked(prisma.boardNoteRevision.findMany).mockResolvedValue([{ id: 'old-1' }, { id: 'old-2' }] as never)
    await updateBoardNote(actor, WEB, NOTE_ID, { content: 'x' })

    expect(vi.mocked(prisma.boardNoteRevision.findMany).mock.calls[0][0]).toMatchObject({
      where: { noteId: NOTE_ID },
      skip: REVISION_MAX,
    })
    expect(prisma.boardNoteRevision.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['old-1', 'old-2'] } } })
  })
})

describe('deleteBoardNote', () => {
  it('削除直前の全文を版に残す', async () => {
    vi.mocked(prisma.boardNote.findUnique).mockResolvedValue(existing() as never)
    await deleteBoardNote(actor, AGENT, NOTE_ID)

    expect(prisma.boardNote.delete).toHaveBeenCalledWith({ where: { id: NOTE_ID } })
    expect(vi.mocked(prisma.boardNoteRevision.create).mock.calls[0][0].data).toMatchObject({
      noteId: NOTE_ID,
      action: 'deleted',
      via: 'mcp',
      ...snapshot(),
    })
  })

  it('エージェントはナレッジを消せない', async () => {
    vi.mocked(prisma.boardNote.findUnique).mockResolvedValue(existing({ kind: 'knowledge' }) as never)
    expect(await errorTypeOf(deleteBoardNote(actor, AGENT, NOTE_ID))).toBe(BOARD_NOTE_KNOWLEDGE_DENIED)
    expect(prisma.boardNote.delete).not.toHaveBeenCalled()
  })
})

describe('restoreBoardNoteRevision', () => {
  const revision = { ...snapshot({ content: '昔の本文' }), noteId: NOTE_ID, boardId: BOARD_ID }

  beforeEach(() => {
    vi.mocked(prisma.boardNoteRevision.findUnique).mockResolvedValue(revision as never)
  })

  it('削除済みなら同じ id で作り直す', async () => {
    vi.mocked(prisma.boardNote.findUnique).mockResolvedValue(null)
    const result = await restoreBoardNoteRevision(actor, 'rev-1')

    expect(result.result).toBe('created')
    expect(vi.mocked(prisma.boardNote.create).mock.calls[0][0].data).toMatchObject({
      id: NOTE_ID,
      boardId: BOARD_ID,
      content: '昔の本文',
      updatedVia: 'web',
    })
    expect(vi.mocked(prisma.boardNoteRevision.create).mock.calls[0][0].data).toMatchObject({
      action: 'restored',
      restoredFromId: 'rev-1',
    })
  })

  it('残っているノートはその版の内容で上書きする', async () => {
    vi.mocked(prisma.boardNote.findUnique).mockResolvedValue(snapshot() as never)
    const result = await restoreBoardNoteRevision(actor, 'rev-1')

    expect(result.result).toBe('updated')
    expect(vi.mocked(prisma.boardNote.update).mock.calls[0][0].data).toMatchObject({ content: '昔の本文' })
    expect(prisma.boardNote.count).not.toHaveBeenCalled()
  })

  it('今と同じ内容なら何もしない', async () => {
    vi.mocked(prisma.boardNote.findUnique).mockResolvedValue(snapshot({ content: '昔の本文' }) as never)
    vi.mocked(prisma.boardNote.findUniqueOrThrow).mockResolvedValue({ updatedAt: UPDATED_AT } as never)

    expect((await restoreBoardNoteRevision(actor, 'rev-1')).result).toBe('unchanged')
    expect(prisma.boardNoteRevision.create).not.toHaveBeenCalled()
  })

  it('作り直すときも件数の上限を見る', async () => {
    vi.mocked(prisma.boardNote.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.boardNote.count).mockResolvedValue(MEMORY_MAX)
    expect(await errorTypeOf(restoreBoardNoteRevision(actor, 'rev-1'))).toBe(BOARD_NOTE_LIMIT_REACHED)
  })
})

describe('findBoardNoteIndex', () => {
  it('メモリが上限より少なければ件数を数え直さない', async () => {
    vi.mocked(prisma.boardNote.findMany)
      .mockResolvedValueOnce([{ name: 'k', description: 'ナレッジ' }] as never)
      .mockResolvedValueOnce([{ name: 'm', description: 'メモリ' }] as never)

    expect(await findBoardNoteIndex(BOARD_ID)).toEqual({ boardKnowledge: ['k: ナレッジ'], boardMemory: ['m: メモリ'] })
    expect(prisma.boardNote.count).not.toHaveBeenCalled()
  })

  it('上限まで載ったときは総数から載せきれなかった件数を出す', async () => {
    const memory = Array.from({ length: MCP_MEMORY_INDEX_LIMIT }, (_, i) => ({ name: `m${i}`, description: 'x' }))
    vi.mocked(prisma.boardNote.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(memory as never)
    vi.mocked(prisma.boardNote.count).mockResolvedValue(MCP_MEMORY_INDEX_LIMIT + 7)

    expect(await findBoardNoteIndex(BOARD_ID)).toMatchObject({ boardMemoryOmitted: 7 })
  })
})
