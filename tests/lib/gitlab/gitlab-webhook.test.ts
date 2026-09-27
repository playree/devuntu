/**
 * GitLab Webhook のイベント処理
 *
 * prisma を差し替え、「対応付けたプロジェクトのイベントだけを扱うこと」「自動紐付けの条件」
 * 「古いイベントで巻き戻さない更新時刻の決め方」「マージで完了にする条件」を検証する。
 */

import { completeTicketByMerge } from '@/lib/board/ticket-mutation'
import { handleGitlabEvent, parseGitlabTime } from '@/lib/gitlab/gitlab-webhook'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    boardRepository: ['findMany'],
    ticket: ['findUnique'],
    ticketLink: ['createMany', 'updateMany', 'findMany'],
    gitCheckSuite: ['updateMany', 'createMany'],
  }),
)

vi.mock('@/lib/board/board-repository', () => ({
  gitlabBaseUrls: () => ['https://example.com/gitlab'],
}))

vi.mock('@/lib/board/ticket-mutation', () => ({
  completeTicketByMerge: vi.fn(async () => true),
}))

const BASE_URL = 'https://example.com/gitlab'
const TARGET = {
  id: 'r1',
  baseUrl: BASE_URL,
  repo: 'group/proj',
  board: { id: 'b1', key: 'ABC', completeOnPrMerge: true },
}
const KEY = { provider: 'gitlab', baseUrl: BASE_URL, repo: 'group/proj' }

const mergeRequestEvent = (override: { action?: string; state?: string; branch?: string; path?: string } = {}) => ({
  object_kind: 'merge_request',
  project: { id: 1, path_with_namespace: override.path ?? 'Group/Proj' },
  object_attributes: {
    iid: 7,
    title: 'タイトル',
    state: override.state ?? 'opened',
    draft: false,
    action: override.action ?? 'open',
    updated_at: '2026-09-27 10:00:00 UTC',
    source_branch: override.branch ?? 'feature/ABC-1',
    last_commit: { id: 'ABC123' },
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.ticket.findUnique).mockResolvedValue({ id: 't1' } as never)
  vi.mocked(prisma.ticketLink.createMany).mockResolvedValue({ count: 1 })
  vi.mocked(prisma.ticketLink.updateMany).mockResolvedValue({ count: 1 })
  vi.mocked(prisma.ticketLink.findMany).mockResolvedValue([])
  vi.mocked(prisma.boardRepository.findMany).mockResolvedValue([])
  vi.mocked(prisma.gitCheckSuite.updateMany).mockResolvedValue({ count: 0 })
  vi.mocked(prisma.gitCheckSuite.createMany).mockResolvedValue({ count: 1 })
})

describe('parseGitlabTime', () => {
  it('ISO 8601 と、空白区切り(UTC / オフセット付き)の形を読む', () => {
    expect(parseGitlabTime('2026-09-27T10:00:00Z')?.toISOString()).toBe('2026-09-27T10:00:00.000Z')
    expect(parseGitlabTime('2026-09-27 10:00:00 UTC')?.toISOString()).toBe('2026-09-27T10:00:00.000Z')
    expect(parseGitlabTime('2026-09-27 19:00:00 +0900')?.toISOString()).toBe('2026-09-27T10:00:00.000Z')
  })

  it('読めなければ null', () => {
    expect(parseGitlabTime(null)).toBeNull()
    expect(parseGitlabTime('')).toBeNull()
    expect(parseGitlabTime('yesterday')).toBeNull()
  })
})

describe('Merge Request Hook', () => {
  it('対応付けたプロジェクトと違うイベントは何もしない(登録先の取り違え)', async () => {
    await handleGitlabEvent('Merge Request Hook', mergeRequestEvent({ path: 'group/other' }), TARGET)

    expect(prisma.ticketLink.createMany).not.toHaveBeenCalled()
    expect(prisma.ticketLink.updateMany).not.toHaveBeenCalled()
  })

  it('ブランチ名の表示IDがボードのキーと一致すれば、MR を自動で紐付ける', async () => {
    await handleGitlabEvent('Merge Request Hook', mergeRequestEvent(), TARGET)

    expect(prisma.ticket.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { boardId_number: { boardId: 'b1', number: 1 } } }),
    )
    expect(prisma.ticketLink.createMany).toHaveBeenCalledWith({
      data: {
        ticketId: 't1',
        ...KEY,
        kind: 'pull_request',
        ref: '7',
        url: `${BASE_URL}/group/proj/-/merge_requests/7`,
        source: 'auto',
      },
      skipDuplicates: true,
    })
  })

  it('別のボードのキーの表示IDでは紐付けない', async () => {
    await handleGitlabEvent('Merge Request Hook', mergeRequestEvent({ branch: 'feature/XYZ-1' }), TARGET)

    expect(prisma.ticketLink.createMany).not.toHaveBeenCalled()
  })

  it('MR の状態を、対応付けのボードのリンクへ反映する', async () => {
    await handleGitlabEvent('Merge Request Hook', mergeRequestEvent(), TARGET)

    const call = vi.mocked(prisma.ticketLink.updateMany).mock.calls[0][0]
    expect(call?.where).toMatchObject({ ...KEY, kind: 'pull_request', ref: '7', ticket: { boardId: { in: ['b1'] } } })
    expect(call?.data).toEqual({
      title: 'タイトル',
      prState: 'open',
      headSha: 'abc123',
      syncedAt: new Date('2026-09-27T10:00:00Z'),
    })
  })

  it('マージされたら完了の判定をする', async () => {
    vi.mocked(prisma.ticketLink.findMany)
      .mockResolvedValueOnce([{ ticketId: 't1', ticket: { boardId: 'b1' } }] as never)
      .mockResolvedValueOnce([{ prState: 'merged' }] as never)
    vi.mocked(prisma.boardRepository.findMany).mockResolvedValue([KEY] as never)

    await handleGitlabEvent('Merge Request Hook', mergeRequestEvent({ action: 'merge', state: 'merged' }), TARGET)

    expect(completeTicketByMerge).toHaveBeenCalledWith('t1', 'group/proj!7')
  })

  it('完了の判定は、Webhook を受けられる対応付けの PR / MR だけで行う', async () => {
    vi.mocked(prisma.ticketLink.findMany)
      .mockResolvedValueOnce([{ ticketId: 't1', ticket: { boardId: 'b1' } }] as never)
      .mockResolvedValueOnce([{ prState: 'merged' }] as never)
    vi.mocked(prisma.boardRepository.findMany).mockResolvedValue([
      KEY,
      { provider: 'github', baseUrl: '', repo: 'owner/repo' },
      // GITLAB_URLS から外したインスタンス
      { provider: 'gitlab', baseUrl: 'https://old.example.com', repo: 'group/proj' },
    ] as never)

    await handleGitlabEvent('Merge Request Hook', mergeRequestEvent({ action: 'merge', state: 'merged' }), TARGET)

    expect(vi.mocked(prisma.ticketLink.findMany).mock.calls[1][0]?.where).toMatchObject({
      OR: [KEY, { provider: 'github', baseUrl: '', repo: 'owner/repo' }],
    })
    expect(completeTicketByMerge).toHaveBeenCalled()
  })

  it('head の無いイベントでは、保存済みの head を消さない', async () => {
    const event = mergeRequestEvent({ action: 'update' })
    await handleGitlabEvent(
      'Merge Request Hook',
      { ...event, object_attributes: { ...event.object_attributes, last_commit: undefined } },
      TARGET,
    )

    expect(vi.mocked(prisma.ticketLink.updateMany).mock.calls[0][0]?.data).toMatchObject({ headSha: undefined })
  })

  it('閉じた後の編集(update)では完了の判定をしない', async () => {
    await handleGitlabEvent('Merge Request Hook', mergeRequestEvent({ action: 'update', state: 'merged' }), TARGET)

    expect(prisma.ticketLink.findMany).not.toHaveBeenCalled()
    expect(completeTicketByMerge).not.toHaveBeenCalled()
  })

  it('マージで完了にしないボードでは判定しない', async () => {
    await handleGitlabEvent('Merge Request Hook', mergeRequestEvent({ action: 'merge', state: 'merged' }), {
      ...TARGET,
      board: { ...TARGET.board, completeOnPrMerge: false },
    })

    expect(completeTicketByMerge).not.toHaveBeenCalled()
  })
})

describe('Pipeline Hook', () => {
  const pipelineEvent = (status: string) => ({
    object_kind: 'pipeline',
    project: { id: 1, path_with_namespace: 'group/proj' },
    object_attributes: {
      id: 55,
      sha: 'DEF456',
      status,
      created_at: '2026-09-27 10:00:00 UTC',
      finished_at: null,
    },
    builds: [
      { created_at: '2026-09-27 10:00:00 UTC', started_at: '2026-09-27 10:01:00 UTC', finished_at: null },
      { created_at: '2026-09-27 10:00:00 UTC', started_at: null, finished_at: '2026-09-27 10:03:00 UTC' },
    ],
  })

  it('パイプラインを Check Suite として保存する。更新時刻はジョブの時刻の最新', async () => {
    await handleGitlabEvent('Pipeline Hook', pipelineEvent('running'), TARGET)

    expect(prisma.gitCheckSuite.createMany).toHaveBeenCalledWith({
      data: {
        ...KEY,
        suiteId: '55',
        repositoryId: 'r1',
        headSha: 'def456',
        appName: 'GitLab CI',
        status: 'in_progress',
        conclusion: null,
        syncedAt: new Date('2026-09-27T10:03:00Z'),
      },
      skipDuplicates: true,
    })
  })

  it('失敗は completed / failure として保存する', async () => {
    await handleGitlabEvent('Pipeline Hook', pipelineEvent('failed'), TARGET)

    expect(vi.mocked(prisma.gitCheckSuite.updateMany).mock.calls[0][0]).toMatchObject({
      where: { ...KEY, suiteId: '55', repositoryId: 'r1', syncedAt: { lte: new Date('2026-09-27T10:03:00Z') } },
      data: { status: 'completed', conclusion: 'failure' },
    })
  })

  it('対応付けたプロジェクトと違うイベントは何もしない', async () => {
    await handleGitlabEvent(
      'Pipeline Hook',
      { ...pipelineEvent('success'), project: { id: 2, path_with_namespace: 'group/other' } },
      TARGET,
    )

    expect(prisma.gitCheckSuite.updateMany).not.toHaveBeenCalled()
  })
})

it('扱わないイベントは何もしない', async () => {
  await handleGitlabEvent('Push Hook', { object_kind: 'push' }, TARGET)
  await handleGitlabEvent('Merge Request Hook', { broken: true }, TARGET)

  expect(prisma.ticketLink.updateMany).not.toHaveBeenCalled()
  expect(prisma.gitCheckSuite.updateMany).not.toHaveBeenCalled()
})
