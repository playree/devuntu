/**
 * ダッシュボードのエージェント系 Widget の取得条件。
 * 承認者でないユーザーには選択肢に出さず、Server Action を直接呼ばれても DB を引かないことを固定する。
 */

import {
  AGENT_APPROVALS_LIMIT,
  AGENT_RUNS_WIDGET_LIMIT,
  canUseAgentWidgets,
  listPendingApprovalTickets,
  listRecentAgentRuns,
} from '@/lib/agent/agent-widget'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { ticket: { findMany: vi.fn(), count: vi.fn() }, agentRun: { findMany: vi.fn() } },
}))

vi.mock('@/lib/agent/agent-approver', () => ({
  listApprovableAgents: vi.fn(),
}))

const { listApprovableAgents } = await import('@/lib/agent/agent-approver')

const userId = '019e0000-0000-7000-8000-00000000000a'
const agentId = '019e0000-0000-7000-8000-0000000000a1'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.ticket.findMany).mockResolvedValue([])
  vi.mocked(prisma.ticket.count).mockResolvedValue(0)
  vi.mocked(prisma.agentRun.findMany).mockResolvedValue([])
})

describe('承認者でないユーザー', () => {
  beforeEach(() => {
    vi.mocked(listApprovableAgents).mockResolvedValue([])
  })

  it('Widget を選択肢に出さない', async () => {
    await expect(canUseAgentWidgets(userId)).resolves.toBe(false)
  })

  it('承認待ちは空で、チケットを引かない', async () => {
    await expect(listPendingApprovalTickets(userId)).resolves.toEqual({ items: [], total: 0 })
    expect(prisma.ticket.findMany).not.toHaveBeenCalled()
    expect(prisma.ticket.count).not.toHaveBeenCalled()
  })

  it('実行状況は空で、実行履歴を引かない', async () => {
    await expect(listRecentAgentRuns(userId)).resolves.toEqual([])
    expect(prisma.agentRun.findMany).not.toHaveBeenCalled()
  })
})

describe('承認者のユーザー', () => {
  beforeEach(() => {
    vi.mocked(listApprovableAgents).mockResolvedValue([{ id: agentId, name: 'Agent' }])
  })

  it('Widget を選択肢に出す', async () => {
    await expect(canUseAgentWidgets(userId)).resolves.toBe(true)
    expect(listApprovableAgents).toHaveBeenCalledWith(userId)
  })

  it('承認待ちは承認対象エージェントの、未完了かつエージェントモード未選択のチケットに絞る', async () => {
    vi.mocked(prisma.ticket.count).mockResolvedValue(12)
    vi.mocked(prisma.ticket.findMany).mockResolvedValue([
      {
        id: 't1',
        number: 5,
        title: 'title',
        priority: 'high',
        board: { key: 'ABC' },
        assignee: { name: 'Agent' },
      },
    ] as never)

    const result = await listPendingApprovalTickets(userId)

    const args = vi.mocked(prisma.ticket.findMany).mock.calls[0][0] as { where: Record<string, unknown>; take: number }
    expect(args.where).toEqual({
      assigneeId: { in: [agentId] },
      status: { in: ['backlog', 'todo', 'doing'] },
      agentMode: null,
      board: { archived: false },
    })
    expect(args.take).toBe(AGENT_APPROVALS_LIMIT)
    expect(vi.mocked(prisma.ticket.count).mock.calls[0][0]?.where, '件数も同じ条件で数える').toEqual(args.where)
    expect(result).toEqual({
      items: [{ id: 't1', title: 'title', priority: 'high', displayId: 'ABC-5', agentName: 'Agent' }],
      total: 12,
    })
  })

  it('実行状況は承認対象エージェントのランナーの実行に絞り、新しい順に上限まで返す', async () => {
    const startedAt = new Date('2026-09-24T00:00:00Z')
    vi.mocked(prisma.agentRun.findMany).mockResolvedValue([
      {
        id: 'r1',
        ticketId: 't1',
        ticketRef: 'ABC-5',
        action: 'plan',
        status: 'succeeded',
        startedAt,
        finishedAt: null,
        runner: { user: { name: 'Agent' } },
      },
    ] as never)

    const result = await listRecentAgentRuns(userId)

    const args = vi.mocked(prisma.agentRun.findMany).mock.calls[0][0] as {
      where: unknown
      orderBy: unknown
      take: number
    }
    expect(args.where).toEqual({ runner: { userId: { in: [agentId] } } })
    expect(args.orderBy).toEqual([{ startedAt: 'desc' }, { id: 'desc' }])
    expect(args.take).toBe(AGENT_RUNS_WIDGET_LIMIT)
    expect(result).toEqual([
      {
        id: 'r1',
        ticketId: 't1',
        ticketRef: 'ABC-5',
        action: 'plan',
        status: 'succeeded',
        startedAt,
        finishedAt: null,
        agentName: 'Agent',
      },
    ])
  })
})
