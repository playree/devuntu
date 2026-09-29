/**
 * 受け入れ条件(ticket-criterion.ts)の単体テスト
 *
 * 項目の置き換えで確認状態を引き継ぐ / リセットする条件と、他のチケットの項目を触らせないことを確かめる。
 */

import { assertTicketAccess } from '@/lib/board/board-access'
import { assertAgentCriteria, checkTicketCriterion, syncTicketCriteria } from '@/lib/board/ticket-criterion'
import { ClientError } from '@/lib/error'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakeTx = vi.hoisted(() => ({
  ticketCriterion: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', async () => (await import('../../helpers/prisma')).mockPrisma({}, { tx: fakeTx }))

vi.mock('@/lib/board/board-access', () => ({
  assertTicketAccess: vi.fn(),
}))

const TICKET_ID = 't1'
const tx = fakeTx as never

beforeEach(() => {
  vi.clearAllMocks()
  fakeTx.ticketCriterion.findMany.mockResolvedValue([
    { id: 'c1', text: '条件1' },
    { id: 'c2', text: '条件2' },
    { id: 'c3', text: '条件3' },
  ])
})

describe('syncTicketCriteria', () => {
  it('一覧の順に並べ直し、文言を変えた項目だけ確認状態を戻す', async () => {
    await syncTicketCriteria(tx, TICKET_ID, [
      { id: 'c2', text: '条件2' },
      { id: 'c1', text: '条件1(修正)' },
      { text: '新しい条件' },
    ])

    // 一覧に無い c3 は消える
    expect(fakeTx.ticketCriterion.deleteMany).toHaveBeenCalledWith({
      where: { ticketId: TICKET_ID, id: { notIn: ['c2', 'c1'] } },
    })
    expect(fakeTx.ticketCriterion.update).toHaveBeenCalledWith({
      where: { id: 'c2' },
      data: { order: 0, text: '条件2' },
    })
    expect(fakeTx.ticketCriterion.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({
        order: 1,
        text: '条件1(修正)',
        checkedById: null,
        checkedAt: null,
        agentMet: null,
        agentEvidence: null,
      }),
    })
    expect(fakeTx.ticketCriterion.create).toHaveBeenCalledWith({
      data: { ticketId: TICKET_ID, order: 2, text: '新しい条件' },
    })
  })

  it('消した文言と足した文言を返す(文言の変更は両方に入り、並べ替えだけの項目は入らない)', async () => {
    const diff = await syncTicketCriteria(tx, TICKET_ID, [
      { id: 'c2', text: '条件2' },
      { id: 'c1', text: '条件1(修正)' },
      { text: '新しい条件' },
    ])

    expect(diff).toEqual({ removed: ['条件3', '条件1'], added: ['条件1(修正)', '新しい条件'] })
  })

  it('他のチケットの項目の id は受け付けない', async () => {
    await expect(syncTicketCriteria(tx, TICKET_ID, [{ id: 'other', text: 'x' }])).rejects.toBeInstanceOf(ClientError)
    expect(fakeTx.ticketCriterion.deleteMany).not.toHaveBeenCalled()
  })

  it('同じ id を重ねて渡すことはできない', async () => {
    await expect(
      syncTicketCriteria(tx, TICKET_ID, [
        { id: 'c1', text: '条件1' },
        { id: 'c1', text: '条件1' },
      ]),
    ).rejects.toBeInstanceOf(ClientError)
  })
})

describe('checkTicketCriterion', () => {
  it('チケットの編集権限を確かめてから、確認した人を記録する', async () => {
    fakeTx.ticketCriterion.findUnique.mockResolvedValue({ ticketId: TICKET_ID })

    await checkTicketCriterion({ id: 'u1' }, 'c1', true)

    expect(assertTicketAccess).toHaveBeenCalledWith({ id: 'u1' }, TICKET_ID, 'edit', fakeTx)
    expect(fakeTx.ticketCriterion.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { checkedById: 'u1', checkedAt: expect.any(Date) },
    })
  })

  it('チェックを外すと確認した人も消える', async () => {
    fakeTx.ticketCriterion.findUnique.mockResolvedValue({ ticketId: TICKET_ID })

    await checkTicketCriterion({ id: 'u1' }, 'c1', false)

    expect(fakeTx.ticketCriterion.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { checkedById: null, checkedAt: null },
    })
  })
})

describe('assertAgentCriteria', () => {
  it('申告がすべてそのチケットの項目なら通す', async () => {
    fakeTx.ticketCriterion.count.mockResolvedValue(1)

    await assertAgentCriteria(tx, TICKET_ID, [{ id: 'c1', met: false, evidence: '未対応' }])

    expect(fakeTx.ticketCriterion.count).toHaveBeenCalledWith({ where: { ticketId: TICKET_ID, id: { in: ['c1'] } } })
  })

  it('そのチケットに無い項目が混ざっていたら throw する', async () => {
    fakeTx.ticketCriterion.count.mockResolvedValue(1)

    await expect(
      assertAgentCriteria(tx, TICKET_ID, [
        { id: 'c1', met: true, evidence: 'ok' },
        { id: 'other', met: true, evidence: 'ok' },
      ]),
    ).rejects.toBeInstanceOf(ClientError)
  })

  it('同じ項目を重ねて申告することはできない', async () => {
    fakeTx.ticketCriterion.count.mockResolvedValue(1)

    await expect(
      assertAgentCriteria(tx, TICKET_ID, [
        { id: 'c1', met: true, evidence: 'ok' },
        { id: 'c1', met: false, evidence: 'ng' },
      ]),
    ).rejects.toBeInstanceOf(ClientError)
  })

  it('申告が空なら問い合わせない', async () => {
    await assertAgentCriteria(tx, TICKET_ID, [])
    expect(fakeTx.ticketCriterion.count).not.toHaveBeenCalled()
  })
})
