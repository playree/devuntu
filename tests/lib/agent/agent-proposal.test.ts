/**
 * 子チケットの起票案(agent-proposal.ts / schema-ticket.ts の parseChildProposal)の単体テスト
 */

import { applyChildProposal } from '@/lib/agent/agent-proposal'
import type { TicketAccess } from '@/lib/board/board-access'
import { insertTicket } from '@/lib/board/ticket-mutation'
import { parseChildProposal, type ChildProposal } from '@/lib/schema/schema-ticket'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakeTx = vi.hoisted(() => ({
  ticket: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
}))

vi.mock('@/lib/prisma', async () => (await import('../../helpers/prisma')).mockPrisma({}, { tx: fakeTx }))
vi.mock('@/lib/board/board-access', () => ({ assertTicketAccess: vi.fn() }))
vi.mock('@/lib/board/ticket-mutation', () => ({
  insertComment: vi.fn(),
  insertTicket: vi.fn(async (_tx, _actor, input: { title: string }) => ({ id: `id-${input.title}` })),
}))

const access = (canEditAgentMode: boolean) =>
  ({ ticketId: 'parent', boardId: 'b1', assigneeId: 'agent-1', canEditAgentMode }) as TicketAccess

const proposal: ChildProposal = {
  children: [
    { title: 'A', content: '本文', order: 1, mode: 'auto', acceptanceCriteria: ['条件'] },
    { title: 'B', order: 2, mode: null, acceptanceCriteria: [] },
  ],
  advance: 'reported',
}

beforeEach(() => {
  vi.clearAllMocks()
  fakeTx.ticket.findUniqueOrThrow.mockResolvedValue({ priority: 'high', tags: [{ tagId: 'tag-1' }] })
})

describe('applyChildProposal', () => {
  it('順番どおりに子を起票し、優先度・タグは親から引き継ぐ', async () => {
    const created = await applyChildProposal(fakeTx as never, { id: 'u1' }, access(true), proposal)

    expect(created.map((ticket) => ticket.id)).toEqual(['id-A', 'id-B'])
    expect(insertTicket).toHaveBeenNthCalledWith(
      1,
      fakeTx,
      { id: 'u1' },
      {
        boardId: 'b1',
        title: 'A',
        content: '本文',
        status: 'todo',
        priority: 'high',
        tagIds: ['tag-1'],
        assigneeId: 'agent-1',
        criteria: ['条件'],
        parentId: 'parent',
        childOrder: 1,
      },
    )
    // 処理方式の無い子は人が担当する前提で未割り当て
    expect(insertTicket).toHaveBeenNthCalledWith(
      2,
      fakeTx,
      { id: 'u1' },
      expect.objectContaining({ title: 'B', assigneeId: null, childOrder: 2 }),
    )
  })

  it('承認者が承認したときだけ処理方式を付け、親は処理を終える', async () => {
    await applyChildProposal(fakeTx as never, { id: 'u1' }, access(true), proposal)

    expect(fakeTx.ticket.update).toHaveBeenCalledWith({
      where: { id: 'id-A' },
      data: { agentMode: 'auto', agentState: null },
    })
    expect(fakeTx.ticket.update).toHaveBeenCalledWith({
      where: { id: 'parent' },
      data: { childAdvance: 'reported', agentState: 'done' },
    })
  })

  it('次へ進む条件の指定が無ければ、親の設定を書き換えない', async () => {
    await applyChildProposal(fakeTx as never, { id: 'u1' }, access(true), { ...proposal, advance: undefined })

    expect(fakeTx.ticket.update).toHaveBeenCalledWith({ where: { id: 'parent' }, data: { agentState: 'done' } })
  })

  it('承認者でなければ処理方式は付けない(担当の割り当てだけ)', async () => {
    await applyChildProposal(fakeTx as never, { id: 'u1' }, access(false), proposal)

    expect(fakeTx.ticket.update).toHaveBeenCalledTimes(1)
    expect(fakeTx.ticket.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'parent' } }))
  })
})

describe('parseChildProposal', () => {
  it('保存した起票案を読み、既定値を補う', () => {
    expect(parseChildProposal({ children: [{ title: 'A', order: 1, mode: 'plan' }] })).toEqual({
      children: [{ title: 'A', order: 1, mode: 'plan', acceptanceCriteria: [] }],
    })
  })

  it('無い・形が崩れていれば null', () => {
    expect(parseChildProposal(null)).toBeNull()
    expect(parseChildProposal({ children: [] })).toBeNull()
    expect(parseChildProposal({ children: [{ title: 'A', order: 0, mode: null }] })).toBeNull()
  })
})
