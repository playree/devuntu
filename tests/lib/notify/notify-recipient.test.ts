/**
 * 宛先の解決
 *
 * エージェントの実行結果の DM にはチケットのタイトルや要約が載るので、
 * 今はチケットを閲覧できない作成者へは送らない。
 */

import { getTicketAccess } from '@/lib/board/board-access'
import type { NotifyPayload } from '@/lib/notify/notify-payload'
import { resolveNotifyTargets } from '@/lib/notify/notify-recipient'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/board/board-access', () => ({
  getTicketAccess: vi.fn(),
}))
vi.mock('@/lib/notify/notify-board-setting', () => ({ getBoardNotifyChannels: vi.fn(async () => []) }))
vi.mock('@/lib/prisma', () => ({ prisma: { ticket: { findUnique: vi.fn() } } }))

const payload = { ticketId: 't1', boardId: 'b1' } as NotifyPayload<'agent_run'>
const explicit = { userIds: [] }

const mockRequester = (requester: { id: string; role: string | null; isAgent: boolean } | null) =>
  vi.mocked(prisma.ticket.findUnique).mockResolvedValue((requester ? { createdBy: requester } : null) as never)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveNotifyTargets(agent_run)', () => {
  it('チケットを閲覧できる作成者へ DM する', async () => {
    mockRequester({ id: 'u1', role: 'user', isAgent: false })
    vi.mocked(getTicketAccess).mockResolvedValue({ canView: true } as never)

    expect((await resolveNotifyTargets('agent_run', payload, explicit)).userIds).toEqual(['u1'])
    expect(getTicketAccess).toHaveBeenCalledWith({ id: 'u1', role: 'user', isAgent: false }, 't1')
  })

  it('ボードから外れるなどして閲覧できない作成者へは送らない', async () => {
    mockRequester({ id: 'u1', role: 'user', isAgent: false })
    vi.mocked(getTicketAccess).mockResolvedValue({ canView: false } as never)

    expect((await resolveNotifyTargets('agent_run', payload, explicit)).userIds).toEqual([])
  })

  it('作成者がエージェントなら送らない', async () => {
    mockRequester({ id: 'agent-1', role: null, isAgent: true })

    expect((await resolveNotifyTargets('agent_run', payload, explicit)).userIds).toEqual([])
    expect(getTicketAccess).not.toHaveBeenCalled()
  })

  it('チケットが削除済みなら送らない', async () => {
    mockRequester(null)

    expect((await resolveNotifyTargets('agent_run', payload, explicit)).userIds).toEqual([])
  })
})
