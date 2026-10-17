/**
 * PR / MR のマージによる自動完了(completeTicketByMerge)
 *
 * 受け入れ条件の判定で未達が残れば完了にせず、保留の履歴と通知を1回だけ残すことを検証する。
 */

import { recordTicketActivities } from '@/lib/board/ticket-activity'
import { completeTicketByMerge } from '@/lib/board/ticket-mutation'
import { lockTicketRow, moveTicketToLane } from '@/lib/board/ticket-write'
import { enqueueTicketCompletedByMerge, enqueueTicketMergeHeld } from '@/lib/notify/notify-trigger'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({ ticket: ['findUnique'], ticketActivity: ['findFirst'] }),
)

vi.mock('@/lib/board/ticket-write', () => ({
  assertReplyTarget: vi.fn(),
  lockTicketRow: vi.fn(),
  moveTicketToLane: vi.fn(),
  nextTicketNumber: vi.fn(),
  reassignContentAttachments: vi.fn(),
}))

vi.mock('@/lib/board/ticket-activity', () => ({ recordTicketActivities: vi.fn() }))

vi.mock('@/lib/notify/notify-trigger', () => ({
  enqueueTicketCommented: vi.fn(),
  enqueueTicketCompletedByMerge: vi.fn(),
  enqueueTicketCreated: vi.fn(),
  enqueueTicketMergeHeld: vi.fn(),
  enqueueTicketMoved: vi.fn(),
  enqueueTicketUpdated: vi.fn(),
}))

const TICKET_ID = 't1'
const PR = 'owner/repo#12'
const CHECKED_AT = new Date('2026-10-01T00:00:00Z')

const criterion = (text: string, checkedAt: Date | null, agentMet: boolean | null) => ({ text, checkedAt, agentMet })

const mockTicket = (criteria: ReturnType<typeof criterion>[], overrides: Record<string, unknown> = {}) =>
  vi.mocked(prisma.ticket.findUnique).mockResolvedValueOnce({
    id: TICKET_ID,
    boardId: 'b1',
    status: 'doing',
    board: { archived: false },
    criteria,
    ...overrides,
  } as never)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.ticketActivity.findFirst).mockResolvedValue(null)
})

describe('completeTicketByMerge: 完了にする', () => {
  it('受け入れ条件が無ければ完了にする', async () => {
    mockTicket([])

    expect(await completeTicketByMerge(TICKET_ID, PR, 'checked')).toBe(true)
    expect(moveTicketToLane).toHaveBeenCalledWith(prisma, {
      access: { ticketId: TICKET_ID, boardId: 'b1', status: 'doing' },
      status: 'done',
      by: { actorId: null, source: 'merge' },
    })
    expect(enqueueTicketCompletedByMerge).toHaveBeenCalledWith({ ticketId: TICKET_ID, pullRequest: PR }, prisma)
    expect(vi.mocked(lockTicketRow).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.ticket.findUnique).mock.invocationCallOrder[0],
    )
  })

  it('判定が「チェックしない」なら未達の条件があっても完了にする', async () => {
    mockTicket([criterion('タグを打つ', null, null)])

    expect(await completeTicketByMerge(TICKET_ID, PR, 'none')).toBe(true)
    expect(recordTicketActivities).not.toHaveBeenCalled()
  })

  it('人の確認または自己申告なら、どちらかで満たした条件は達成とみなす', async () => {
    mockTicket([criterion('確認済み', CHECKED_AT, null), criterion('自己申告', null, true)])

    expect(await completeTicketByMerge(TICKET_ID, PR, 'checkedOrReported')).toBe(true)
  })
})

describe('completeTicketByMerge: 保留する', () => {
  it('未達の条件があれば完了にせず、保留の履歴と通知を残す', async () => {
    mockTicket([criterion('確認済み', CHECKED_AT, null), criterion('タグを打つ', null, false)])

    expect(await completeTicketByMerge(TICKET_ID, PR, 'checkedOrReported')).toBe(false)
    expect(moveTicketToLane).not.toHaveBeenCalled()
    expect(enqueueTicketCompletedByMerge).not.toHaveBeenCalled()
    expect(recordTicketActivities).toHaveBeenCalledWith(prisma, TICKET_ID, { actorId: null, source: 'merge' }, [
      { field: 'mergeHeld', before: PR, after: 'タグを打つ' },
    ])
    expect(enqueueTicketMergeHeld).toHaveBeenCalledWith({ ticketId: TICKET_ID, pullRequest: PR, unmetCount: 1 }, prisma)
  })

  it('人の確認が必須なら、自己申告だけの条件は未達として保留する', async () => {
    mockTicket([criterion('自己申告', null, true)])

    expect(await completeTicketByMerge(TICKET_ID, PR, 'checked')).toBe(false)
    expect(recordTicketActivities).toHaveBeenCalledWith(prisma, TICKET_ID, { actorId: null, source: 'merge' }, [
      { field: 'mergeHeld', before: PR, after: '自己申告' },
    ])
  })

  it('同じ PR で保留済みなら、再配信では履歴も通知も重ねない', async () => {
    mockTicket([criterion('タグを打つ', null, null)])
    vi.mocked(prisma.ticketActivity.findFirst).mockResolvedValueOnce({ id: 'a1' } as never)

    expect(await completeTicketByMerge(TICKET_ID, PR, 'checkedOrReported')).toBe(false)
    expect(prisma.ticketActivity.findFirst).toHaveBeenCalledWith({
      where: { ticketId: TICKET_ID, field: 'mergeHeld', before: PR },
      select: { id: true },
    })
    expect(recordTicketActivities).not.toHaveBeenCalled()
    expect(enqueueTicketMergeHeld).not.toHaveBeenCalled()
  })
})

describe('completeTicketByMerge: 対象外', () => {
  it.each([
    ['完了済みのチケット', { status: 'done' }],
    ['アーカイブ済みのボード', { board: { archived: true } }],
  ])('%s は判定もしない', async (_label, overrides) => {
    mockTicket([criterion('タグを打つ', null, null)], overrides)

    expect(await completeTicketByMerge(TICKET_ID, PR, 'checkedOrReported')).toBe(false)
    expect(recordTicketActivities).not.toHaveBeenCalled()
    expect(moveTicketToLane).not.toHaveBeenCalled()
  })
})
