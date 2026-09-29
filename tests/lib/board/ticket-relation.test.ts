/**
 * チケット間の関係(ticket-relation.ts)の単体テスト
 *
 * 相手を同じボードの中だけから引くこと、子の親が 1 つに保たれること、関連の向きを正規化することを確かめる。
 */

import { assertTicketAccess } from '@/lib/board/board-access'
import {
  addTicketRelation,
  assignTicketParent,
  listTicketRelations,
  moveTicketChild,
  removeTicketRelation,
  resolveRelationTarget,
  writeTicketParent,
} from '@/lib/board/ticket-relation'
import { RELATION_ALREADY_EXISTS, RELATION_TARGET_INVALID } from '@/lib/board/ticket-relation-rule'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakeTx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  ticket: { findFirst: vi.fn() },
  ticketRelation: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    aggregate: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', async () => (await import('../../helpers/prisma')).mockPrisma({}, { tx: fakeTx }))

vi.mock('@/lib/board/board-access', () => ({
  assertTicketAccess: vi.fn(),
}))

const tx = fakeTx as never
const actor = { id: 'u1' }
const BOARD_ID = 'b1'
const TICKET_ID = '0195c1e0-0000-7000-8000-000000000002'
const OTHER_ID = '0195c1e0-0000-7000-8000-000000000001'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertTicketAccess).mockImplementation(
    async (_actor, ticketId) => ({ ticketId, boardId: BOARD_ID }) as never,
  )
  fakeTx.ticket.findFirst.mockResolvedValue({ id: OTHER_ID })
  fakeTx.ticketRelation.findFirst.mockResolvedValue(null)
  fakeTx.ticketRelation.findUnique.mockResolvedValue(null)
  fakeTx.ticketRelation.aggregate.mockResolvedValue({ _max: { order: null } })
})

describe('resolveRelationTarget', () => {
  it('表示IDはキーと番号、番号だけならボード内の番号で引く', async () => {
    await resolveRelationTarget(tx, BOARD_ID, 'abc-12')
    expect(fakeTx.ticket.findFirst).toHaveBeenLastCalledWith({
      where: { boardId: BOARD_ID, number: 12, board: { key: 'ABC' } },
      select: { id: true },
    })

    await resolveRelationTarget(tx, BOARD_ID, '#7')
    expect(fakeTx.ticket.findFirst).toHaveBeenLastCalledWith({
      where: { boardId: BOARD_ID, number: 7 },
      select: { id: true },
    })
  })

  it('チケットIDでも同じボードに絞って引く', async () => {
    await resolveRelationTarget(tx, BOARD_ID, OTHER_ID)
    expect(fakeTx.ticket.findFirst).toHaveBeenCalledWith({
      where: { id: OTHER_ID, boardId: BOARD_ID },
      select: { id: true },
    })
  })

  it('見つからない(別ボードを含む)・読めない指定は RELATION_TARGET_INVALID', async () => {
    fakeTx.ticket.findFirst.mockResolvedValue(null)
    await expect(resolveRelationTarget(tx, BOARD_ID, 'XYZ-1')).rejects.toMatchObject({
      errorType: RELATION_TARGET_INVALID,
    })
    await expect(resolveRelationTarget(tx, BOARD_ID, 'foo')).rejects.toMatchObject({
      errorType: RELATION_TARGET_INVALID,
    })
    expect(fakeTx.ticket.findFirst).toHaveBeenCalledTimes(1)
  })
})

describe('writeTicketParent', () => {
  it('子の行をロックし、既存の親を置き換えて兄弟の末尾に入れる', async () => {
    fakeTx.ticketRelation.findFirst.mockResolvedValue({ id: 'r0', fromId: 'old-parent' })
    fakeTx.ticketRelation.aggregate.mockResolvedValue({ _max: { order: 3 } })

    await writeTicketParent(tx, TICKET_ID, OTHER_ID)

    expect(fakeTx.$queryRaw).toHaveBeenCalled()
    expect(fakeTx.ticketRelation.deleteMany).toHaveBeenCalledWith({ where: { type: 'parent', toId: TICKET_ID } })
    expect(fakeTx.ticketRelation.create).toHaveBeenCalledWith({
      data: { type: 'parent', fromId: OTHER_ID, toId: TICKET_ID, order: 4 },
    })
  })

  it('末尾の順番は親もロックしてから採り、上限を超えない', async () => {
    fakeTx.ticketRelation.aggregate.mockResolvedValue({ _max: { order: 999 } })

    await writeTicketParent(tx, TICKET_ID, OTHER_ID)

    // 子と親の 2 行をロックする
    expect(fakeTx.$queryRaw).toHaveBeenCalledTimes(2)
    expect(fakeTx.ticketRelation.create).toHaveBeenCalledWith({
      data: { type: 'parent', fromId: OTHER_ID, toId: TICKET_ID, order: 999 },
    })
  })

  it('同じ親のままなら置き換えず、順番の指定だけを反映する', async () => {
    fakeTx.ticketRelation.findFirst.mockResolvedValue({ id: 'r0', fromId: OTHER_ID })

    await writeTicketParent(tx, TICKET_ID, OTHER_ID)
    expect(fakeTx.ticketRelation.update).not.toHaveBeenCalled()

    await writeTicketParent(tx, TICKET_ID, OTHER_ID, 2)
    expect(fakeTx.ticketRelation.update).toHaveBeenCalledWith({ where: { id: 'r0' }, data: { order: 2 } })
    expect(fakeTx.ticketRelation.deleteMany).not.toHaveBeenCalled()
  })

  it('null で親を外す', async () => {
    fakeTx.ticketRelation.findFirst.mockResolvedValue({ id: 'r0', fromId: OTHER_ID })

    await writeTicketParent(tx, TICKET_ID, null)

    expect(fakeTx.ticketRelation.deleteMany).toHaveBeenCalledWith({ where: { type: 'parent', toId: TICKET_ID } })
    expect(fakeTx.ticketRelation.create).not.toHaveBeenCalled()
  })

  it('親を外すのに順番だけを渡すことはできない', async () => {
    await expect(assignTicketParent(tx, { id: TICKET_ID, boardId: BOARD_ID }, null, 2)).rejects.toThrow()
    expect(fakeTx.ticketRelation.deleteMany).not.toHaveBeenCalled()
  })

  it('自分自身を親にはできない', async () => {
    await expect(writeTicketParent(tx, TICKET_ID, TICKET_ID)).rejects.toMatchObject({
      errorType: RELATION_TARGET_INVALID,
    })
  })
})

describe('addTicketRelation', () => {
  it('編集権限を確かめ、関連は ID の小さい方を from にして作る', async () => {
    await addTicketRelation(actor, { ticketId: TICKET_ID, target: 'ABC-1', kind: 'related' })

    expect(assertTicketAccess).toHaveBeenCalledWith(actor, TICKET_ID, 'edit', tx)
    expect(fakeTx.ticketRelation.create).toHaveBeenCalledWith({
      data: { type: 'related', fromId: OTHER_ID, toId: TICKET_ID },
    })
  })

  it('child は相手の親を自分にする', async () => {
    await addTicketRelation(actor, { ticketId: TICKET_ID, target: 'ABC-1', kind: 'child' })

    expect(fakeTx.ticketRelation.create).toHaveBeenCalledWith({
      data: { type: 'parent', fromId: TICKET_ID, toId: OTHER_ID, order: 1 },
    })
  })

  it('parent は自分の親を相手にする', async () => {
    await addTicketRelation(actor, { ticketId: TICKET_ID, target: 'ABC-1', kind: 'parent' })

    expect(fakeTx.ticketRelation.create).toHaveBeenCalledWith({
      data: { type: 'parent', fromId: OTHER_ID, toId: TICKET_ID, order: 1 },
    })
  })

  it('既に同じ関係があれば RELATION_ALREADY_EXISTS', async () => {
    fakeTx.ticketRelation.findUnique.mockResolvedValue({ id: 'r1' })

    await expect(
      addTicketRelation(actor, { ticketId: TICKET_ID, target: 'ABC-1', kind: 'related' }),
    ).rejects.toMatchObject({ errorType: RELATION_ALREADY_EXISTS })
    expect(fakeTx.ticketRelation.create).not.toHaveBeenCalled()
  })

  it('同じ関連の同時追加で一意制約に当たったら RELATION_ALREADY_EXISTS にする', async () => {
    fakeTx.ticketRelation.create.mockRejectedValueOnce({ code: 'P2002' })

    await expect(
      addTicketRelation(actor, { ticketId: TICKET_ID, target: 'ABC-1', kind: 'related' }),
    ).rejects.toMatchObject({ errorType: RELATION_ALREADY_EXISTS })
  })

  it('経路の追加制限は、関連なら両端、親子なら子に掛ける', async () => {
    const authorize = vi.fn()

    await addTicketRelation(actor, { ticketId: TICKET_ID, target: 'ABC-1', kind: 'related' }, { authorize })
    expect(authorize).toHaveBeenCalledTimes(2)
    // 操作するチケットは冒頭で判定済みなので、問い合わせ直すのは相手だけ
    expect(vi.mocked(assertTicketAccess).mock.calls.map((call) => call[1])).toEqual([TICKET_ID, OTHER_ID])

    authorize.mockClear()
    vi.mocked(assertTicketAccess).mockClear()
    await addTicketRelation(actor, { ticketId: TICKET_ID, target: 'ABC-1', kind: 'child' }, { authorize })
    expect(authorize).toHaveBeenCalledTimes(1)
    expect(vi.mocked(assertTicketAccess).mock.calls.map((call) => call[1])).toEqual([TICKET_ID, OTHER_ID])
  })

  it('経路の追加制限で弾かれたら何も書き込まない', async () => {
    const authorize = vi.fn(() => {
      throw new Error('denied')
    })

    await expect(
      addTicketRelation(actor, { ticketId: TICKET_ID, target: 'ABC-1', kind: 'related' }, { authorize }),
    ).rejects.toThrow('denied')
    expect(fakeTx.ticketRelation.create).not.toHaveBeenCalled()
  })

  it('自分自身とは関係を持てない', async () => {
    fakeTx.ticket.findFirst.mockResolvedValue({ id: TICKET_ID })

    await expect(
      addTicketRelation(actor, { ticketId: TICKET_ID, target: 'ABC-2', kind: 'related' }),
    ).rejects.toMatchObject({ errorType: RELATION_TARGET_INVALID })
  })

  it('相手は操作するチケットのボードの中から引く', async () => {
    await addTicketRelation(actor, { ticketId: TICKET_ID, target: '5', kind: 'related' })

    expect(fakeTx.ticket.findFirst).toHaveBeenCalledWith({
      where: { boardId: BOARD_ID, number: 5 },
      select: { id: true },
    })
  })
})

describe('removeTicketRelation / moveTicketChild', () => {
  it('関係の from 側のチケットで編集権限を確かめてから消す', async () => {
    fakeTx.ticketRelation.findUnique.mockResolvedValue({ type: 'related', fromId: OTHER_ID, toId: TICKET_ID })

    await removeTicketRelation(actor, 'r1')

    expect(assertTicketAccess).toHaveBeenCalledWith(actor, OTHER_ID, 'edit', tx)
    expect(fakeTx.ticketRelation.delete).toHaveBeenCalledWith({ where: { id: 'r1' } })
  })

  const sibling = (id: string, order: number, number: number) => ({ id, order, to: { number } })

  it('並べ替えられるのは親子の関係だけ', async () => {
    fakeTx.ticketRelation.findUnique.mockResolvedValue({ type: 'related', fromId: OTHER_ID })
    await expect(moveTicketChild(actor, 'r1', -1)).rejects.toThrow()
    expect(fakeTx.ticketRelation.update).not.toHaveBeenCalled()
  })

  it('前の兄弟と入れ替えて、兄弟全体を 1 からの連番に振り直す(同じ順番は番号順とみなす)', async () => {
    fakeTx.ticketRelation.findUnique.mockResolvedValue({ type: 'parent', fromId: OTHER_ID })
    fakeTx.ticketRelation.findMany.mockResolvedValue([sibling('c', 5, 3), sibling('a', 2, 1), sibling('b', 2, 2)])

    await moveTicketChild(actor, 'c', -1)

    expect(assertTicketAccess).toHaveBeenCalledWith(actor, OTHER_ID, 'edit', tx)
    // 並びは a(2) → b(2) → c(5)。c を前へ動かして a → c → b
    expect(fakeTx.ticketRelation.update.mock.calls).toEqual([
      [{ where: { id: 'a' }, data: { order: 1 } }],
      [{ where: { id: 'c' }, data: { order: 2 } }],
      [{ where: { id: 'b' }, data: { order: 3 } }],
    ])
  })

  it('同じ順番のまとまり(並行して進める兄弟)は振り直しても保つ', async () => {
    fakeTx.ticketRelation.findUnique.mockResolvedValue({ type: 'parent', fromId: OTHER_ID })
    fakeTx.ticketRelation.findMany.mockResolvedValue([
      sibling('a', 1, 1),
      sibling('b', 2, 2),
      sibling('c', 2, 3),
      sibling('d', 3, 4),
    ])

    await moveTicketChild(actor, 'a', 1)

    // b → a → c → d。a は単独の順番になり、間に a が入った b と c は別の順番に分かれる
    expect(fakeTx.ticketRelation.update.mock.calls).toEqual([
      [{ where: { id: 'b' }, data: { order: 1 } }],
      [{ where: { id: 'a' }, data: { order: 2 } }],
      [{ where: { id: 'c' }, data: { order: 3 } }],
      [{ where: { id: 'd' }, data: { order: 4 } }],
    ])
  })

  it('動かした子の前後にないまとまりは同じ順番のまま残す', async () => {
    fakeTx.ticketRelation.findUnique.mockResolvedValue({ type: 'parent', fromId: OTHER_ID })
    fakeTx.ticketRelation.findMany.mockResolvedValue([
      sibling('a', 1, 1),
      sibling('b', 2, 2),
      sibling('c', 3, 3),
      sibling('d', 3, 4),
    ])

    await moveTicketChild(actor, 'b', -1)

    // b → a → c(3) → d(3)。c と d は同じ順番のまま
    expect(fakeTx.ticketRelation.update.mock.calls).toEqual([
      [{ where: { id: 'b' }, data: { order: 1 } }],
      [{ where: { id: 'a' }, data: { order: 2 } }],
    ])
  })

  it('値が変わらない兄弟は更新しない', async () => {
    fakeTx.ticketRelation.findUnique.mockResolvedValue({ type: 'parent', fromId: OTHER_ID })
    fakeTx.ticketRelation.findMany.mockResolvedValue([sibling('a', 1, 1), sibling('b', 2, 2), sibling('c', 3, 3)])

    await moveTicketChild(actor, 'b', 1)

    expect(fakeTx.ticketRelation.update.mock.calls).toEqual([
      [{ where: { id: 'c' }, data: { order: 2 } }],
      [{ where: { id: 'b' }, data: { order: 3 } }],
    ])
  })

  it('端からさらに外へは動かさない', async () => {
    fakeTx.ticketRelation.findUnique.mockResolvedValue({ type: 'parent', fromId: OTHER_ID })
    fakeTx.ticketRelation.findMany.mockResolvedValue([sibling('a', 1, 1), sibling('b', 2, 2)])

    await moveTicketChild(actor, 'a', -1)
    await moveTicketChild(actor, 'b', 1)

    expect(fakeTx.ticketRelation.update).not.toHaveBeenCalled()
  })
})

describe('listTicketRelations', () => {
  const ticket = (id: string, number: number, status = 'todo') => ({
    id,
    number,
    title: `t${number}`,
    status,
    assignee: null,
    board: { key: 'ABC' },
  })
  const self = ticket('self', 10)

  it('親・直下の子(順番→番号の順)・関連(相手側)に振り分けて、子の進み具合を数える', async () => {
    fakeTx.ticketRelation.findMany.mockResolvedValue([
      { id: 'p', type: 'parent', fromId: 'parent', order: 1, from: ticket('parent', 1), to: self },
      { id: 'c2', type: 'parent', fromId: 'self', order: 2, from: self, to: ticket('c2', 12, 'done') },
      { id: 'c3', type: 'parent', fromId: 'self', order: 1, from: self, to: ticket('c3', 13) },
      { id: 'c1', type: 'parent', fromId: 'self', order: 1, from: self, to: ticket('c1', 11, 'done') },
      { id: 'r1', type: 'related', fromId: 'other', order: 0, from: ticket('other', 20), to: self },
    ])

    const result = await listTicketRelations('self', tx)

    expect(result.parent).toMatchObject({ relationId: 'p', displayId: 'ABC-1' })
    expect(result.children.map((child) => child.displayId)).toEqual(['ABC-11', 'ABC-13', 'ABC-12'])
    expect(result.childProgress).toEqual({ done: 2, total: 3 })
    expect(result.related).toEqual([
      { relationId: 'r1', id: 'other', displayId: 'ABC-20', title: 't20', status: 'todo', assigneeName: '' },
    ])
  })
})
