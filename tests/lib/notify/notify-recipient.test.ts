/**
 * 宛先の解決
 *
 * エージェントの実行結果の DM にはチケットのタイトルや要約が載るので、
 * 今はチケットを閲覧できない作成者へは送らない。
 */

import { getTicketAccess } from '@/lib/board/board-access'
import { getBoardNotifyChannels } from '@/lib/notify/notify-board-setting'
import type { NotifyPayload } from '@/lib/notify/notify-payload'
import { resolveNotifyTargets } from '@/lib/notify/notify-recipient'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/board/board-access', () => ({
  getTicketAccess: vi.fn(),
}))
vi.mock('@/lib/notify/notify-board-setting', () => ({ getBoardNotifyChannels: vi.fn(async () => []) }))
vi.mock('@/lib/prisma', async () => (await import('../../helpers/prisma')).mockPrisma({ ticket: ['findUnique'] }))

const payload = { ticketId: 't1', boardId: 'b1' } as NotifyPayload<'agent_run'>
const explicit = { userIds: [] }

const mockRequester = (requester: { id: string; role: string | null; isAgent: boolean } | null) =>
  vi.mocked(prisma.ticket.findUnique).mockResolvedValue((requester ? { createdBy: requester } : null) as never)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getBoardNotifyChannels).mockResolvedValue([])
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

describe('resolveNotifyTargets: チャネル通知の宛先', () => {
  it('agent_run はボードに設定があればチャンネルへも投稿する', async () => {
    mockRequester({ id: 'u1', role: 'user', isAgent: false })
    vi.mocked(getTicketAccess).mockResolvedValue({ canView: true } as never)
    vi.mocked(getBoardNotifyChannels).mockResolvedValue(['C0123ABCD'])

    expect(await resolveNotifyTargets('agent_run', payload, explicit)).toEqual({
      userIds: ['u1'],
      slackChannelIds: ['C0123ABCD'],
    })
    expect(getBoardNotifyChannels).toHaveBeenCalledWith('b1', 'agent_run')
  })

  it('boardId を持たない旧ペイロードはチャンネルを引かず DM だけにする', async () => {
    mockRequester({ id: 'u1', role: 'user', isAgent: false })
    vi.mocked(getTicketAccess).mockResolvedValue({ canView: true } as never)

    const legacy = { ticketId: 't1' } as NotifyPayload<'agent_run'>
    expect(await resolveNotifyTargets('agent_run', legacy, explicit)).toEqual({ userIds: ['u1'], slackChannelIds: [] })
    expect(getBoardNotifyChannels).not.toHaveBeenCalled()
  })
})

describe('resolveNotifyTargets: イベントごとの宛先', () => {
  it('mention はトリガーが渡した宛先だけに DM し、チャンネルには流さない', async () => {
    const targets = await resolveNotifyTargets(
      'mention',
      { ticketId: 't1', boardId: 'b1' } as NotifyPayload<'mention'>,
      {
        userIds: ['u1', 'u2'],
      },
    )

    expect(targets).toEqual({ userIds: ['u1', 'u2'], slackChannelIds: [] })
    expect(getBoardNotifyChannels).not.toHaveBeenCalled()
    expect(prisma.ticket.findUnique).not.toHaveBeenCalled()
  })

  it('ticket_assigned は渡された新担当者へ DM し、ボードの設定があればチャンネルへも流す', async () => {
    vi.mocked(getBoardNotifyChannels).mockResolvedValue(['C0123ABCD'])
    const targets = await resolveNotifyTargets(
      'ticket_assigned',
      { ticketId: 't1', boardId: 'b1' } as NotifyPayload<'ticket_assigned'>,
      { userIds: ['u2'] },
    )

    expect(targets).toEqual({ userIds: ['u2'], slackChannelIds: ['C0123ABCD'] })
    expect(getBoardNotifyChannels).toHaveBeenCalledWith('b1', 'ticket_assigned')
    expect(prisma.ticket.findUnique, '作成者は宛先にしない').not.toHaveBeenCalled()
  })

  it.each(['ticket_created', 'ticket_completed'] as const)(
    '%s はチャネル通知だけで、渡された宛先があっても DM しない',
    async (event) => {
      vi.mocked(getBoardNotifyChannels).mockResolvedValue(['C0123ABCD'])
      const targets = await resolveNotifyTargets(
        event,
        { ticketId: 't1', boardId: 'b1' } as NotifyPayload<typeof event>,
        {
          userIds: ['u1'],
        },
      )

      expect(targets).toEqual({ userIds: [], slackChannelIds: ['C0123ABCD'] })
      expect(getBoardNotifyChannels).toHaveBeenCalledWith('b1', event)
    },
  )
})

describe('resolveNotifyTargets(ticket_merge_held)', () => {
  const held = { ticketId: 't1', boardId: 'b1' } as NotifyPayload<'ticket_merge_held'>
  const HUMAN = { id: 'u1', role: 'user', isAgent: false }
  const REQUESTER = { id: 'u2', role: 'user', isAgent: false }
  const AGENT = { id: 'agent-1', role: null, isAgent: true }

  const mockOwner = (assignee: typeof HUMAN | typeof AGENT | null, createdBy: typeof HUMAN | null) =>
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue({ assignee, createdBy } as never)

  it('担当者が人なら担当者へ DM し、ボードの設定があればチャンネルへも流す', async () => {
    mockOwner(HUMAN, REQUESTER)
    vi.mocked(getTicketAccess).mockResolvedValue({ canView: true } as never)
    vi.mocked(getBoardNotifyChannels).mockResolvedValue(['C0123ABCD'])

    expect(await resolveNotifyTargets('ticket_merge_held', held, explicit)).toEqual({
      userIds: ['u1'],
      slackChannelIds: ['C0123ABCD'],
    })
    expect(getBoardNotifyChannels).toHaveBeenCalledWith('b1', 'ticket_merge_held')
  })

  it.each([
    ['エージェント担当', AGENT],
    ['未割り当て', null],
  ] as const)('%s なら依頼者(作成者)へ DM する', async (_label, assignee) => {
    mockOwner(assignee, REQUESTER)
    vi.mocked(getTicketAccess).mockResolvedValue({ canView: true } as never)

    expect((await resolveNotifyTargets('ticket_merge_held', held, explicit)).userIds).toEqual(['u2'])
  })

  it('閲覧できなくなった担当者へは送らず、作成者へも回さない', async () => {
    mockOwner(HUMAN, REQUESTER)
    vi.mocked(getTicketAccess).mockResolvedValue({ canView: false } as never)

    expect((await resolveNotifyTargets('ticket_merge_held', held, explicit)).userIds).toEqual([])
    expect(getTicketAccess).toHaveBeenCalledTimes(1)
  })
})

describe('resolveNotifyTargets(ticket_due)', () => {
  const due = { ticketId: 't1', boardId: 'b1', dueDate: '2026-10-20' } as NotifyPayload<'ticket_due'>

  const mockTicket = (state: { status: string; dueDate: Date | null }) =>
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue({
      ...state,
      assignee: { id: 'u1', role: 'user', isAgent: false },
      createdBy: { id: 'u2', role: 'user', isAgent: false },
    } as never)

  it('担当者へ DM し、チャンネルへは流さない', async () => {
    mockTicket({ status: 'doing', dueDate: new Date('2026-10-20T00:00:00Z') })
    vi.mocked(getTicketAccess).mockResolvedValue({ canView: true } as never)

    expect(await resolveNotifyTargets('ticket_due', due, explicit)).toEqual({ userIds: ['u1'], slackChannelIds: [] })
    expect(getBoardNotifyChannels).not.toHaveBeenCalled()
  })

  it.each([
    ['完了した', { status: 'done', dueDate: new Date('2026-10-20T00:00:00Z') }],
    ['期限を変えた', { status: 'doing', dueDate: new Date('2026-10-27T00:00:00Z') }],
    ['期限を外した', { status: 'doing', dueDate: null }],
  ])('投入後に%sチケットには送らない', async (_label, state) => {
    mockTicket(state)
    vi.mocked(getTicketAccess).mockResolvedValue({ canView: true } as never)

    expect((await resolveNotifyTargets('ticket_due', due, explicit)).userIds).toEqual([])
  })
})
