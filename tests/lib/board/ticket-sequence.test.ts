/**
 * 子チケットの順番待ちの判定(ticket-relation-rule.ts / ticket-sequence.ts)の単体テスト
 */

import { isSiblingSettled, isWaitingForSiblings, type SequenceSibling } from '@/lib/board/ticket-relation-rule'
import { findWaitingTicketIds } from '@/lib/board/ticket-sequence'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({ ticketRelation: ['findMany'], ticket: ['findMany'] }),
)

const ticketRelation = vi.mocked(prisma.ticketRelation)
const ticket = vi.mocked(prisma.ticket)

const sibling = (id: string, order: number, override: Partial<SequenceSibling> = {}): SequenceSibling => ({
  id,
  order,
  status: 'todo',
  agentState: null,
  ...override,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('isSiblingSettled', () => {
  it('完了は条件によらず済み', () => {
    expect(isSiblingSettled({ status: 'done', agentState: null }, 'done')).toBe(true)
    expect(isSiblingSettled({ status: 'done', agentState: null }, 'reported')).toBe(true)
  })

  it('報告済みは reported のときだけ済み', () => {
    expect(isSiblingSettled({ status: 'doing', agentState: 'done' }, 'done')).toBe(false)
    expect(isSiblingSettled({ status: 'doing', agentState: 'done' }, 'reported')).toBe(true)
  })

  it('返信待ち・失敗は済んでいない', () => {
    expect(isSiblingSettled({ status: 'doing', agentState: 'planned' }, 'reported')).toBe(false)
    expect(isSiblingSettled({ status: 'doing', agentState: 'failed' }, 'reported')).toBe(false)
  })
})

describe('isWaitingForSiblings', () => {
  const siblings = [sibling('a', 1), sibling('b', 2), sibling('c', 2), sibling('d', 3)]

  it('最初の順番は待たない', () => {
    expect(isWaitingForSiblings({ id: 'a', order: 1 }, siblings, 'done')).toBe(false)
  })

  it('前の順番が済んでいなければ待つ', () => {
    expect(isWaitingForSiblings({ id: 'b', order: 2 }, siblings, 'done')).toBe(true)
  })

  it('同じ順番の兄弟は待たない(並行して進めてよい)', () => {
    const done = [sibling('a', 1, { status: 'done' }), sibling('b', 2), sibling('c', 2)]
    expect(isWaitingForSiblings({ id: 'b', order: 2 }, done, 'done')).toBe(false)
    expect(isWaitingForSiblings({ id: 'c', order: 2 }, done, 'done')).toBe(false)
  })

  it('同じ順番の兄弟が 1 件でも済んでいなければ、次の順番は待つ', () => {
    const partial = [
      sibling('a', 1, { status: 'done' }),
      sibling('b', 2, { status: 'done' }),
      sibling('c', 2),
      sibling('d', 3),
    ]
    expect(isWaitingForSiblings({ id: 'd', order: 3 }, partial, 'done')).toBe(true)
  })

  it('人が担当する兄弟も同じく待つ。reported でも報告の無い兄弟は完了まで待つ', () => {
    const human = [sibling('a', 1, { status: 'doing' }), sibling('b', 2)]
    expect(isWaitingForSiblings({ id: 'b', order: 2 }, human, 'reported')).toBe(true)
  })

  it('reported では報告済みの兄弟の次へ進める', () => {
    const reported = [sibling('a', 1, { status: 'doing', agentState: 'done' }), sibling('b', 2)]
    expect(isWaitingForSiblings({ id: 'b', order: 2 }, reported, 'reported')).toBe(false)
    expect(isWaitingForSiblings({ id: 'b', order: 2 }, reported, 'done')).toBe(true)
  })
})

describe('findWaitingTicketIds', () => {
  it('親の条件と兄弟から順番待ちの子を返す', async () => {
    ticketRelation.findMany.mockResolvedValueOnce([
      { toId: 'b', fromId: 'p1', order: 2 },
      { toId: 'c', fromId: 'p1', order: 2 },
      { toId: 'y', fromId: 'p2', order: 2 },
    ] as never)
    ticket.findMany.mockResolvedValueOnce([
      {
        id: 'p1',
        childAdvance: 'done',
        relationsFrom: [
          { order: 1, to: { id: 'a', status: 'doing', agentState: 'done' } },
          { order: 2, to: { id: 'b', status: 'todo', agentState: null } },
          { order: 2, to: { id: 'c', status: 'todo', agentState: null } },
        ],
      },
      {
        id: 'p2',
        childAdvance: 'reported',
        relationsFrom: [
          { order: 1, to: { id: 'x', status: 'doing', agentState: 'done' } },
          { order: 2, to: { id: 'y', status: 'todo', agentState: null } },
        ],
      },
    ] as never)

    expect(await findWaitingTicketIds(['b', 'c', 'y', 'orphan'])).toEqual(new Set(['b', 'c']))
    expect(ticketRelation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { type: 'parent', toId: { in: ['b', 'c', 'y', 'orphan'] } } }),
    )
    // 同じ親の子が複数あっても、親(と兄弟の一覧)は 1 回ずつだけ引く
    expect(ticket.findMany).toHaveBeenCalledTimes(1)
    expect(ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['p1', 'p2'] } } }))
  })

  it('完了済みの子は、前の兄弟が済んでいなくても順番待ちにしない', async () => {
    ticketRelation.findMany.mockResolvedValueOnce([{ toId: 'b', fromId: 'p1', order: 2 }] as never)
    ticket.findMany.mockResolvedValueOnce([
      {
        id: 'p1',
        childAdvance: 'done',
        relationsFrom: [
          { order: 1, to: { id: 'a', status: 'doing', agentState: null } },
          { order: 2, to: { id: 'b', status: 'done', agentState: null } },
        ],
      },
    ] as never)

    expect(await findWaitingTicketIds(['b'])).toEqual(new Set())
  })

  it('親の無いチケットだけなら親を引かない', async () => {
    ticketRelation.findMany.mockResolvedValueOnce([] as never)

    expect(await findWaitingTicketIds(['orphan'])).toEqual(new Set())
    expect(ticket.findMany).not.toHaveBeenCalled()
  })

  it('対象が無ければ問い合わせない', async () => {
    expect(await findWaitingTicketIds([])).toEqual(new Set())
    expect(ticketRelation.findMany).not.toHaveBeenCalled()
  })
})
