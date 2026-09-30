import { assertBoardAccess } from '@/lib/board/board-access'
import { kanbanDoneSince, kanbanLaneWhere } from '@/lib/board/kanban'
import { assertReplyTarget, moveTicketToLane, reassignContentAttachments } from '@/lib/board/ticket-write'
import { ClientError } from '@/lib/error'
import { toUploadUrl } from '@/lib/storage/upload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fakeTx = (parent: { ticketId: string; parentId: string | null } | null) =>
  ({
    ticketComment: { findUnique: vi.fn().mockResolvedValue(parent) },
  }) as never

describe('assertReplyTarget', () => {
  it('返信先が同一チケットのトップレベルコメントなら通す', async () => {
    await expect(
      assertReplyTarget(fakeTx({ ticketId: 'ticket-1', parentId: null }), 'ticket-1', 'comment-1'),
    ).resolves.toBeUndefined()
  })

  it('返信先が存在しなければ拒否する', async () => {
    await expect(assertReplyTarget(fakeTx(null), 'ticket-1', 'comment-1')).rejects.toThrow(ClientError)
  })

  it('返信先が既に返信(parentId あり)なら拒否する(2階層目を禁止)', async () => {
    await expect(
      assertReplyTarget(fakeTx({ ticketId: 'ticket-1', parentId: 'comment-0' }), 'ticket-1', 'comment-1'),
    ).rejects.toThrow(ClientError)
  })

  it('返信先が別チケットのコメントなら拒否する', async () => {
    await expect(
      assertReplyTarget(fakeTx({ ticketId: 'ticket-2', parentId: null }), 'ticket-1', 'comment-1'),
    ).rejects.toThrow(ClientError)
  })
})

/**
 * 添付の付け替えは「まだどの本文からも使われていないもの」に限る。
 * 使用中のものを動かすと元のボードのメンバーからその本文の画像が読めなくなるため。
 */
describe('reassignContentAttachments', () => {
  const KEY = '019eef64-6cc1-78f1-8f50-1ef86986289a.webp'
  const BOARD_ID = '019eef64-6cc1-78f1-8f50-1ef869860002'
  const actor = { id: 'u1' }
  const content = `本文\n![shot](${toUploadUrl(KEY)})`

  const fakeAttachmentTx = (options: { candidates?: { key: string }[]; ticket?: object; comment?: object } = {}) => {
    const tx = {
      attachment: {
        findMany: vi.fn().mockResolvedValue(options.candidates ?? [{ key: KEY }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      ticket: { findFirst: vi.fn().mockResolvedValue(options.ticket ?? null) },
      ticketComment: { findFirst: vi.fn().mockResolvedValue(options.comment ?? null) },
    }
    return tx
  }

  it('本文に画像が無ければ添付を引かない', async () => {
    const tx = fakeAttachmentTx()
    await reassignContentAttachments(tx as never, '画像なしの本文', BOARD_ID, actor)

    expect(tx.attachment.findMany).not.toHaveBeenCalled()
    expect(tx.attachment.updateMany).not.toHaveBeenCalled()
  })

  it('別ボードの自分の添付で未使用なら付け替える', async () => {
    const tx = fakeAttachmentTx()
    await reassignContentAttachments(tx as never, content, BOARD_ID, actor)

    expect(tx.attachment.findMany).toHaveBeenCalledWith({
      where: { key: { in: [KEY] }, createdById: 'u1', boardId: { not: BOARD_ID } },
      select: { key: true },
    })
    expect(tx.attachment.updateMany).toHaveBeenCalledWith({
      where: { key: { in: [KEY] } },
      data: { boardId: BOARD_ID },
    })
  })

  it('保存先と同じボードの添付は候補にならず、何も更新しない', async () => {
    const tx = fakeAttachmentTx({ candidates: [] })
    await reassignContentAttachments(tx as never, content, BOARD_ID, actor)

    expect(tx.ticket.findFirst).not.toHaveBeenCalled()
    expect(tx.attachment.updateMany).not.toHaveBeenCalled()
  })

  it('他のチケット本文から使われていれば付け替えない', async () => {
    const tx = fakeAttachmentTx({ ticket: { id: 'other-ticket' } })
    await reassignContentAttachments(tx as never, content, BOARD_ID, actor)

    expect(tx.attachment.updateMany).not.toHaveBeenCalled()
  })

  it('他のチケットのコメントから使われていれば付け替えない', async () => {
    const tx = fakeAttachmentTx({ comment: { id: 'other-comment' } })
    await reassignContentAttachments(tx as never, content, BOARD_ID, actor)

    expect(tx.attachment.updateMany).not.toHaveBeenCalled()
  })

  it('保存対象のチケットとそのコメントは使用中に数えない', async () => {
    const tx = fakeAttachmentTx()
    await reassignContentAttachments(tx as never, content, BOARD_ID, actor, 'ticket-1')

    expect(tx.ticket.findFirst).toHaveBeenCalledWith({
      where: { content: { contains: toUploadUrl(KEY) }, id: { not: 'ticket-1' } },
      select: { id: true },
    })
    expect(tx.ticketComment.findFirst).toHaveBeenCalledWith({
      where: { content: { contains: toUploadUrl(KEY) }, ticketId: { not: 'ticket-1' } },
      select: { id: true },
    })
    expect(tx.attachment.updateMany).toHaveBeenCalled()
  })
})

/** 'write' は 'view' に「アーカイブ済みでない」を足したもの。チケット作成と添付の入口で使う */
describe('assertBoardAccess', () => {
  const boardTx = (board: { archived: boolean; role: 'owner' | 'member' } | null) =>
    ({
      board: {
        findUnique: vi.fn().mockResolvedValue(
          board && {
            id: 'board-1',
            kind: 'team',
            archived: board.archived,
            members: [{ role: board.role }],
            groups: [],
          },
        ),
      },
    }) as never
  const actor = { id: 'u1', role: null }

  it('write はメンバーかつ未アーカイブなら通す', async () => {
    await expect(
      assertBoardAccess(actor, 'board-1', 'write', boardTx({ archived: false, role: 'member' })),
    ).resolves.toMatchObject({ boardId: 'board-1', role: 'member' })
  })

  it('write はアーカイブ済みボードを拒否する(オーナーでも)', async () => {
    await expect(
      assertBoardAccess(actor, 'board-1', 'write', boardTx({ archived: true, role: 'owner' })),
    ).rejects.toThrow(ClientError)
  })

  it('view はアーカイブ済みボードでも通す', async () => {
    await expect(
      assertBoardAccess(actor, 'board-1', 'view', boardTx({ archived: true, role: 'member' })),
    ).resolves.toMatchObject({ archived: true })
  })

  it('write はメンバーでなければ拒否する', async () => {
    await expect(assertBoardAccess(actor, 'board-1', 'write', boardTx(null))).rejects.toThrow(ClientError)
  })
})

/**
 * レーンは盤面に見えているカードだけで数え、order は 0 から詰め直す。
 * 並びが変わった行だけを 1 文の生 SQL で更新する。
 */
describe('moveTicketToLane', () => {
  const NOW = new Date('2026-09-01T00:00:00.000Z')
  const BOARD_ID = 'board-1'

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const laneTx = (lane: { id: string; order: number }[]) => ({
    ticket: {
      findMany: vi.fn().mockResolvedValue(lane),
      update: vi.fn().mockResolvedValue({}),
    },
    ticketActivity: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    $executeRaw: vi.fn().mockResolvedValue(0),
  })

  /** 生 SQL に渡した (id, order) の組。Prisma.join の値は平坦に並ぶ */
  const shiftedRows = (tx: ReturnType<typeof laneTx>) => {
    const values = (tx.$executeRaw.mock.calls[0][1] as { values: unknown[] }).values
    const rows: [unknown, unknown][] = []
    for (let i = 0; i < values.length; i += 2) {
      rows.push([values[i], values[i + 1]])
    }
    return rows
  }

  const access = (status: 'todo' | 'doing' | 'done') => ({ ticketId: 't', boardId: BOARD_ID, status })
  const by = { actorId: 'user-1' }

  it('移動先レーンは同じボード・同じステータスの盤面に見えるカードで引く', async () => {
    const tx = laneTx([])
    await moveTicketToLane(tx as never, { access: access('todo'), status: 'done', by })

    expect(tx.ticket.findMany).toHaveBeenCalledWith({
      where: kanbanLaneWhere(BOARD_ID, 'done', kanbanDoneSince(NOW)),
      select: { id: true, order: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    })
  })

  it('index を省けば末尾に入れ、他のカードは更新しない', async () => {
    const tx = laneTx([
      { id: 'a', order: 0 },
      { id: 'b', order: 1 },
    ])
    expect(await moveTicketToLane(tx as never, { access: access('todo'), status: 'doing', by })).toEqual({
      id: 't',
      status: 'doing',
      order: 2,
    })
    expect(tx.ticket.update).toHaveBeenCalledWith({
      where: { id: 't' },
      data: { status: 'doing', order: 2, completedAt: null },
    })
    expect(tx.$executeRaw).not.toHaveBeenCalled()
  })

  it('先頭に入れれば後ろのカードを 1 文でずらす', async () => {
    const tx = laneTx([
      { id: 'a', order: 0 },
      { id: 'b', order: 1 },
    ])
    expect(
      await moveTicketToLane(tx as never, { access: access('todo'), status: 'doing', index: 0, by }),
    ).toMatchObject({
      order: 0,
    })
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
    expect(shiftedRows(tx)).toEqual([
      ['a', 1],
      ['b', 2],
    ])
  })

  it('ステータスが変われば変更者付きで履歴に残す', async () => {
    const tx = laneTx([])
    await moveTicketToLane(tx as never, { access: access('todo'), status: 'doing', by })
    expect(tx.ticketActivity.createMany).toHaveBeenCalledWith({
      data: [{ ticketId: 't', actorId: 'user-1', source: 'user', field: 'status', before: 'todo', after: 'doing' }],
    })
  })

  it('マージによる自動完了は変更者なしで経路を残す', async () => {
    const tx = laneTx([])
    await moveTicketToLane(tx as never, {
      access: access('doing'),
      status: 'done',
      by: { actorId: null, source: 'merge' },
    })
    expect(tx.ticketActivity.createMany).toHaveBeenCalledWith({
      data: [{ ticketId: 't', actorId: null, source: 'merge', field: 'status', before: 'doing', after: 'done' }],
    })
  })

  it('同一レーン内の並べ替えは履歴に残さない', async () => {
    const tx = laneTx([{ id: 'a', order: 0 }])
    await moveTicketToLane(tx as never, { access: access('todo'), status: 'todo', index: 0, by })
    expect(tx.ticketActivity.createMany).not.toHaveBeenCalled()
  })

  it('done へ移せば完了日時を入れる', async () => {
    const tx = laneTx([])
    await moveTicketToLane(tx as never, { access: access('doing'), status: 'done', by })
    expect(tx.ticket.update).toHaveBeenCalledWith({
      where: { id: 't' },
      data: { status: 'done', order: 0, completedAt: NOW },
    })
  })

  it('done から戻せば完了日時を消す', async () => {
    const tx = laneTx([])
    await moveTicketToLane(tx as never, { access: access('done'), status: 'todo', by })
    expect(tx.ticket.update).toHaveBeenCalledWith({
      where: { id: 't' },
      data: { status: 'todo', order: 0, completedAt: null },
    })
  })

  it('同一レーン内の並べ替えでは完了日時に触れず、order が変わる行だけ更新する', async () => {
    const tx = laneTx([
      { id: 'a', order: 0 },
      { id: 't', order: 1 },
      { id: 'b', order: 2 },
    ])
    await moveTicketToLane(tx as never, { access: access('done'), status: 'done', index: 0, by })

    expect(tx.ticket.update).toHaveBeenCalledWith({ where: { id: 't' }, data: { status: 'done', order: 0 } })
    expect(shiftedRows(tx)).toEqual([['a', 1]])
  })

  it('同じ位置へ落としたなら自分の update だけで済ませる', async () => {
    const tx = laneTx([
      { id: 'a', order: 0 },
      { id: 't', order: 1 },
    ])
    await moveTicketToLane(tx as never, { access: access('todo'), status: 'todo', index: 1, by })

    expect(tx.ticket.update).toHaveBeenCalledWith({ where: { id: 't' }, data: { status: 'todo', order: 1 } })
    expect(tx.$executeRaw).not.toHaveBeenCalled()
  })

  it('範囲外の index は両端にクランプする', async () => {
    const lane = [
      { id: 'a', order: 0 },
      { id: 'b', order: 1 },
    ]
    const tail = laneTx(lane)
    expect(
      await moveTicketToLane(tail as never, { access: access('todo'), status: 'doing', index: 99, by }),
    ).toMatchObject({ order: 2 })
    expect(tail.$executeRaw).not.toHaveBeenCalled()

    const head = laneTx(lane)
    expect(
      await moveTicketToLane(head as never, { access: access('todo'), status: 'doing', index: -1, by }),
    ).toMatchObject({ order: 0 })
    expect(shiftedRows(head)).toEqual([
      ['a', 1],
      ['b', 2],
    ])
  })

  it('order に隙間や重複があれば 0 から詰め直す', async () => {
    const tx = laneTx([
      { id: 'a', order: 5 },
      { id: 'b', order: 5 },
      { id: 'c', order: 2 },
    ])
    await moveTicketToLane(tx as never, { access: access('todo'), status: 'doing', by })

    expect(tx.ticket.update).toHaveBeenCalledWith({
      where: { id: 't' },
      data: { status: 'doing', order: 3, completedAt: null },
    })
    expect(shiftedRows(tx)).toEqual([
      ['a', 0],
      ['b', 1],
    ])
  })
})
