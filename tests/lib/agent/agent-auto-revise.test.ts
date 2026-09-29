/**
 * CI の失敗・レビュー指摘による自動差し戻し(agent-auto-revise.ts)の単体テスト
 *
 * 対象チケットの絞り込み、処理状態ごとの分岐(差し戻す / まとめる / 捨てる)、上限、重複、
 * 待ち時間の判定を確かめる。
 */

import {
  AUTO_REVISE_SETTLE_MS,
  hasSettledAutoRevise,
  listRunAutoRevise,
  requestAutoRevise,
} from '@/lib/agent/agent-auto-revise'
import type { GitLinkedBoard, GitRepoKey } from '@/lib/git/git-webhook'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    ticket: ['findUnique', 'update'],
    ticketLink: ['findMany'],
    agentRun: ['findFirst'],
    agentAutoReviseTrigger: ['findUnique', 'findFirst', 'findMany', 'create', 'update', 'aggregate'],
  }),
)

const KEY: GitRepoKey = { provider: 'github', baseUrl: '', repo: 'owner/repo' }
const BOARD: GitLinkedBoard = { id: 'b1', key: 'ABC', completeOnPrMerge: false, autoRevise: true, autoReviseLimit: 3 }
const LINK = { ticketId: 't1', ref: '12', url: 'https://github.com/owner/repo/pull/12', ticket: { boardId: 'b1' } }
const REVIEW = { source: 'review' as const, dedupeKey: 'review:1', body: '指摘', author: 'coderabbitai[bot]' }

const mockTicket = (agentState: string, agentAutoReviseCount = 0) =>
  vi.mocked(prisma.ticket.findUnique).mockResolvedValue({ agentState, agentAutoReviseCount } as never)

const request = (trigger = REVIEW, boards = [BOARD]) =>
  requestAutoRevise({ key: KEY, boards, pullRequest: { number: 12 } }, trigger)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.ticketLink.findMany).mockResolvedValue([LINK] as never)
  vi.mocked(prisma.agentAutoReviseTrigger.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.agentAutoReviseTrigger.findFirst).mockResolvedValue(null)
})

describe('requestAutoRevise', () => {
  it('無効なボードだけなら何も引かない', async () => {
    await request(REVIEW, [{ ...BOARD, autoRevise: false }])

    expect(prisma.ticketLink.findMany).not.toHaveBeenCalled()
  })

  it('開いている PR のリンクを持つ、エージェント担当・オプトイン済み・未完了のチケットに絞る', async () => {
    mockTicket('done')
    await request()

    expect(vi.mocked(prisma.ticketLink.findMany).mock.calls[0][0]?.where).toEqual({
      ...KEY,
      kind: 'pull_request',
      dismissed: false,
      ref: '12',
      OR: [{ prState: null }, { prState: { in: ['open', 'draft'] } }],
      ticket: {
        boardId: { in: ['b1'] },
        assignee: { isAgent: true },
        agentMode: { not: null },
        status: { in: ['backlog', 'todo', 'doing'] },
      },
    })
  })

  it('報告済みなら、きっかけを作って planned へ戻し、回数を増やす', async () => {
    mockTicket('done', 2)
    await request()

    expect(prisma.$queryRaw).toHaveBeenCalled()
    expect(prisma.agentAutoReviseTrigger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketId: 't1',
        ...KEY,
        number: 12,
        source: 'review',
        dedupeKey: 'review:1',
        body: '指摘',
        author: 'coderabbitai[bot]',
        // レビューの URL が無ければ PR の URL
        url: LINK.url,
      }),
    })
    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { agentState: 'planned', agentAutoReviseCount: { increment: 1 } } }),
    )
  })

  it('上限に達していれば差し戻さない', async () => {
    mockTicket('done', 3)
    await request()

    expect(prisma.agentAutoReviseTrigger.create).not.toHaveBeenCalled()
    expect(prisma.ticket.update).not.toHaveBeenCalled()
  })

  it('差し戻し後、拾われる前に届いたきっかけは同じ差し戻しにまとめる(回数は増やさない)', async () => {
    mockTicket('planned', 1)
    vi.mocked(prisma.agentAutoReviseTrigger.findFirst).mockResolvedValue({ id: 'pending' } as never)
    await request({ ...REVIEW, dedupeKey: 'review:2' })

    expect(prisma.agentAutoReviseTrigger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ticketId: 't1', dedupeKey: 'review:2' }),
    })
    expect(prisma.ticket.update).not.toHaveBeenCalled()
  })

  it('人の返信待ち(未消化のきっかけが無い planned)・処理中では何もしない', async () => {
    for (const state of ['planned', 'running', 'queued', null]) {
      mockTicket(state as string)
      await request()
    }

    expect(prisma.agentAutoReviseTrigger.create).not.toHaveBeenCalled()
    expect(prisma.ticket.update).not.toHaveBeenCalled()
  })

  it('同じきっかけ(再送)は二重に作らない', async () => {
    mockTicket('done')
    vi.mocked(prisma.agentAutoReviseTrigger.findUnique).mockResolvedValue({
      id: 'x',
      consumed: true,
      checks: [],
    } as never)
    await request()

    expect(prisma.agentAutoReviseTrigger.create).not.toHaveBeenCalled()
    expect(prisma.agentAutoReviseTrigger.update).not.toHaveBeenCalled()
    expect(prisma.ticket.update).not.toHaveBeenCalled()
  })

  it('同じ suite の失敗は、引き受ける前ならチェック名を足す', async () => {
    mockTicket('planned')
    vi.mocked(prisma.agentAutoReviseTrigger.findUnique).mockResolvedValue({
      id: 'x',
      consumed: false,
      checks: ['lint'],
    } as never)
    await requestAutoRevise(
      { key: KEY, boards: [BOARD], pullRequest: { headSha: 'abc' } },
      { source: 'ci', dedupeKey: 'ci:99', checks: ['test'] },
    )

    expect(vi.mocked(prisma.ticketLink.findMany).mock.calls[0][0]?.where).toMatchObject({ headSha: 'abc' })
    expect(prisma.agentAutoReviseTrigger.update).toHaveBeenCalledWith({
      where: { id: 'x' },
      data: { checks: ['lint', 'test'] },
    })
    expect(prisma.agentAutoReviseTrigger.create).not.toHaveBeenCalled()
  })

  it('長いレビュー本文は切り詰めて保存する', async () => {
    mockTicket('done')
    await request({ ...REVIEW, body: 'a'.repeat(5000) })

    const data = vi.mocked(prisma.agentAutoReviseTrigger.create).mock.calls[0][0].data
    expect(data.body).toHaveLength(4000)
  })
})

describe('hasSettledAutoRevise', () => {
  const NOW = new Date('2026-09-29T10:00:00Z')
  const aggregate = (count: number, updatedAt: Date | null) =>
    vi.mocked(prisma.agentAutoReviseTrigger.aggregate).mockResolvedValue({
      _count: { _all: count },
      _max: { updatedAt },
    } as never)

  it('最後のきっかけから待ち時間が過ぎていれば拾う', async () => {
    aggregate(2, new Date(NOW.getTime() - AUTO_REVISE_SETTLE_MS))
    expect(await hasSettledAutoRevise('t1', NOW)).toBe(true)
  })

  it('待ち時間の間は拾わない(続けて届く指摘をまとめる)', async () => {
    aggregate(1, new Date(NOW.getTime() - AUTO_REVISE_SETTLE_MS + 1000))
    expect(await hasSettledAutoRevise('t1', NOW)).toBe(false)
  })

  it('未消化のきっかけが無ければ拾わない', async () => {
    aggregate(0, null)
    expect(await hasSettledAutoRevise('t1', NOW)).toBe(false)
  })
})

describe('listRunAutoRevise', () => {
  it('実行中の実行が引き受けたきっかけを返す', async () => {
    vi.mocked(prisma.agentRun.findFirst).mockResolvedValue({ id: 'run-1' } as never)
    vi.mocked(prisma.agentAutoReviseTrigger.findMany).mockResolvedValue([
      { ...KEY, source: 'ci', number: 12, url: 'u1', checks: ['test'], body: null, author: null, reviewState: null },
      {
        ...KEY,
        source: 'review',
        number: 12,
        url: 'u2',
        checks: [],
        body: '指摘',
        author: 'r',
        reviewState: 'commented',
      },
    ] as never)

    const result = await listRunAutoRevise('runner-1', 't1')

    expect(vi.mocked(prisma.agentAutoReviseTrigger.findMany).mock.calls[0][0]?.where).toEqual({ runId: 'run-1' })
    expect(result).toEqual([
      {
        source: 'ci',
        pullRequest: { provider: 'github', repo: 'owner/repo', number: 12 },
        url: 'u1',
        checks: ['test'],
        review: null,
      },
      {
        source: 'review',
        pullRequest: { provider: 'github', repo: 'owner/repo', number: 12 },
        url: 'u2',
        checks: [],
        review: { author: 'r', state: 'commented', body: '指摘' },
      },
    ])
  })

  it('実行中の実行が無ければ空', async () => {
    vi.mocked(prisma.agentRun.findFirst).mockResolvedValue(null)
    expect(await listRunAutoRevise('runner-1', 't1')).toEqual([])
  })
})
