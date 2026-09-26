/** チケットへのリンク登録(同じものの同時登録) */

import { assertTicketAccess } from '@/lib/board/board-access'
import { addTicketLink } from '@/lib/board/ticket-link'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const tx = {
  ticketLink: { findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
}

vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: vi.fn() },
  isUniqueViolation: (e: unknown) => (e as { code?: string })?.code === 'P2002',
}))

vi.mock('@/lib/board/board-access', () => ({
  assertTicketAccess: vi.fn(async () => ({})),
}))

const actor = { id: 'u1' }
const URL = 'https://github.com/owner/repo/pull/12'
const KEY = { ticketId: 't1', provider: 'github', repo: 'owner/repo', kind: 'pull_request', ref: '12' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (t: typeof tx) => unknown) => fn(tx)) as never)
  tx.ticketLink.findUnique.mockResolvedValue(null)
  tx.ticketLink.count.mockResolvedValue(0)
  tx.ticketLink.create.mockResolvedValue({ id: 'l1' })
  tx.ticketLink.update.mockResolvedValue({ id: 'l1' })
})

describe('addTicketLink', () => {
  it('無ければ作る', async () => {
    await expect(addTicketLink(actor, 't1', URL)).resolves.toEqual({ id: 'l1' })
    expect(tx.ticketLink.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ...KEY, source: 'manual', createdById: 'u1' }) }),
    )
  })

  it('同時の登録に先を越されたら、権限を確かめ直して既存の行を表示に戻す', async () => {
    tx.ticketLink.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))

    await expect(addTicketLink(actor, 't1', URL)).resolves.toEqual({ id: 'l1' })
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(assertTicketAccess).toHaveBeenCalledTimes(2)
    expect(tx.ticketLink.update).toHaveBeenCalledWith({
      where: { ticketId_provider_repo_kind_ref: KEY },
      data: { dismissed: false },
      select: { id: true },
    })
  })

  it('一意制約以外の失敗はそのまま投げる', async () => {
    tx.ticketLink.create.mockRejectedValue(new Error('boom'))

    await expect(addTicketLink(actor, 't1', URL)).rejects.toThrow('boom')
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })
})
