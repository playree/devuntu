/**
 * GitHub Webhook のイベント処理
 *
 * prisma を差し替え、「受け口の対応付けと違うリポジトリのイベントを捨てるか」「自動紐付けの条件」「古いイベントで巻き戻さない条件」
 * 「マージで完了にする条件」を検証する。
 */

import { completeTicketByMerge } from '@/lib/board/ticket-mutation'
import { handleGithubEvent } from '@/lib/github/github-webhook'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    boardRepository: { findMany: vi.fn() },
    ticket: { findUnique: vi.fn() },
    ticketLink: { createMany: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    gitCheckSuite: { updateMany: vi.fn(), createMany: vi.fn() },
  },
}))

// GitLab(gitlab.com)も Webhook を受けられる環境として扱う
vi.mock('@/lib/board/board-repository', () => ({
  gitlabBaseUrls: () => ['https://gitlab.com'],
}))

vi.mock('@/lib/board/ticket-mutation', () => ({
  completeTicketByMerge: vi.fn(async () => true),
}))

const BOARD = { id: 'b1', key: 'ABC', completeOnPrMerge: true }
/** 受け口の URL が指す対応付け */
const TARGET = { id: 'r1', repo: 'owner/repo', board: BOARD }
const UPDATED_AT = '2026-09-26T10:00:00Z'

const pullRequestEvent = (override: { action?: string; ref?: string; state?: string; merged?: boolean } = {}) => ({
  action: override.action ?? 'opened',
  repository: { full_name: 'Owner/Repo' },
  pull_request: {
    number: 12,
    title: 'タイトル',
    state: override.state ?? 'open',
    draft: false,
    merged: override.merged ?? false,
    updated_at: UPDATED_AT,
    head: { ref: override.ref ?? 'feature/ABC-1', sha: 'abc123' },
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.boardRepository.findMany).mockResolvedValue([])
  vi.mocked(prisma.ticket.findUnique).mockResolvedValue({ id: 't1' } as never)
  vi.mocked(prisma.ticketLink.createMany).mockResolvedValue({ count: 1 })
  vi.mocked(prisma.ticketLink.updateMany).mockResolvedValue({ count: 1 })
  vi.mocked(prisma.ticketLink.findMany).mockResolvedValue([])
  vi.mocked(prisma.gitCheckSuite.updateMany).mockResolvedValue({ count: 0 })
  vi.mocked(prisma.gitCheckSuite.createMany).mockResolvedValue({ count: 1 })
})

describe('pull_request', () => {
  it('受け口の対応付けと違うリポジトリのイベントは何もしない', async () => {
    await handleGithubEvent('pull_request', pullRequestEvent(), { ...TARGET, repo: 'owner/other' })

    expect(prisma.ticketLink.createMany).not.toHaveBeenCalled()
    expect(prisma.ticketLink.updateMany).not.toHaveBeenCalled()
  })

  it('ブランチ名の表示IDが対応付けたボードのキーと一致すれば自動で紐付ける', async () => {
    await handleGithubEvent('pull_request', pullRequestEvent(), TARGET)

    expect(prisma.ticket.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { boardId_number: { boardId: 'b1', number: 1 } } }),
    )
    expect(prisma.ticketLink.createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketId: 't1',
        kind: 'pull_request',
        repo: 'owner/repo',
        ref: '12',
        source: 'auto',
      }),
      // 外したリンク(dismissed)も行が残っているので作り直さない
      skipDuplicates: true,
    })
  })

  it('別のボードのキーの表示IDには紐付けない', async () => {
    await handleGithubEvent('pull_request', pullRequestEvent({ ref: 'feature/XYZ-1' }), TARGET)

    expect(prisma.ticket.findUnique).not.toHaveBeenCalled()
    expect(prisma.ticketLink.createMany).not.toHaveBeenCalled()
    // 手で紐付けたリンクの状態は更新する
    expect(prisma.ticketLink.updateMany).toHaveBeenCalled()
  })

  it('反映済みより古いイベントでは状態を巻き戻さない', async () => {
    await handleGithubEvent('pull_request', pullRequestEvent(), TARGET)

    const where = vi.mocked(prisma.ticketLink.updateMany).mock.calls[0][0].where
    expect(where).toMatchObject({
      repo: 'owner/repo',
      kind: 'pull_request',
      ref: '12',
      ticket: { boardId: { in: ['b1'] } },
      OR: [
        { syncedAt: null },
        { syncedAt: { lt: new Date(UPDATED_AT) } },
        // 同じ時刻ならマージ済みを戻さない
        { syncedAt: new Date(UPDATED_AT), prState: { not: 'merged' } },
      ],
    })
    expect(vi.mocked(prisma.ticketLink.updateMany).mock.calls[0][0].data).toMatchObject({
      prState: 'open',
      headSha: 'abc123',
    })
  })

  /** 完了判定でのボードのリポジトリ一覧 */
  const mockBoardRepositories = () =>
    vi.mocked(prisma.boardRepository.findMany).mockResolvedValueOnce([
      { provider: 'github', baseUrl: '', repo: 'owner/repo' },
      { provider: 'gitlab', baseUrl: 'https://gitlab.com', repo: 'group/other' },
    ] as never)

  it('マージで紐付いた PR がすべて片付けば完了にする', async () => {
    mockBoardRepositories()
    vi.mocked(prisma.ticketLink.findMany)
      .mockResolvedValueOnce([{ ticketId: 't1', ticket: { boardId: 'b1' } }] as never)
      .mockResolvedValueOnce([{ prState: 'merged' }, { prState: 'closed' }] as never)

    await handleGithubEvent(
      'pull_request',
      pullRequestEvent({ action: 'closed', state: 'closed', merged: true }),
      TARGET,
    )

    expect(completeTicketByMerge).toHaveBeenCalledWith('t1', 'owner/repo#12')
  })

  it('完了の判定はボードに対応付けたリポジトリの PR だけで行う', async () => {
    mockBoardRepositories()
    vi.mocked(prisma.ticketLink.findMany)
      .mockResolvedValueOnce([{ ticketId: 't1', ticket: { boardId: 'b1' } }] as never)
      .mockResolvedValueOnce([{ prState: 'merged' }] as never)

    await handleGithubEvent(
      'pull_request',
      pullRequestEvent({ action: 'closed', state: 'closed', merged: true }),
      TARGET,
    )

    // Webhook の届かないリポジトリの PR(状態が空のまま)が判定を塞がないよう、対応付け済み(provider を問わない)に絞る
    expect(vi.mocked(prisma.ticketLink.findMany).mock.calls[1][0]?.where).toMatchObject({
      ticketId: 't1',
      dismissed: false,
      OR: [
        { provider: 'github', baseUrl: '', repo: 'owner/repo' },
        { provider: 'gitlab', baseUrl: 'https://gitlab.com', repo: 'group/other' },
      ],
    })
    expect(completeTicketByMerge).toHaveBeenCalled()
  })

  it('開いている PR が残っていれば完了にしない', async () => {
    mockBoardRepositories()
    vi.mocked(prisma.ticketLink.findMany)
      .mockResolvedValueOnce([{ ticketId: 't1', ticket: { boardId: 'b1' } }] as never)
      .mockResolvedValueOnce([{ prState: 'merged' }, { prState: 'open' }] as never)

    await handleGithubEvent(
      'pull_request',
      pullRequestEvent({ action: 'closed', state: 'closed', merged: true }),
      TARGET,
    )

    expect(completeTicketByMerge).not.toHaveBeenCalled()
  })

  it('マージで完了にしないボードでは判定しない', async () => {
    await handleGithubEvent('pull_request', pullRequestEvent({ action: 'closed', state: 'closed', merged: true }), {
      ...TARGET,
      board: { ...BOARD, completeOnPrMerge: false },
    })

    expect(prisma.ticketLink.findMany).not.toHaveBeenCalled()
    expect(completeTicketByMerge).not.toHaveBeenCalled()
  })

  it('形の合わないペイロードは捨てる', async () => {
    await handleGithubEvent('pull_request', { action: 'opened' }, TARGET)

    expect(prisma.ticketLink.updateMany).not.toHaveBeenCalled()
  })
})

describe('check_suite / check_run', () => {
  const suite = {
    id: 99,
    head_sha: 'abc123',
    status: 'completed',
    conclusion: 'success',
    updated_at: UPDATED_AT,
    app: { name: 'GitHub Actions' },
  }

  it('新しい suite は作る(古い状態の行があっても巻き戻さない条件で更新を先に試す)', async () => {
    await handleGithubEvent('check_suite', { repository: { full_name: 'owner/repo' }, check_suite: suite }, TARGET)

    expect(prisma.gitCheckSuite.updateMany).toHaveBeenCalledWith({
      where: {
        provider: 'github',
        baseUrl: '',
        repo: 'owner/repo',
        suiteId: '99',
        // 別のボードの対応付けを経由して届いた CI と混ぜないよう、受け取った対応付けを持つ
        repositoryId: 'r1',
        syncedAt: { lte: new Date(UPDATED_AT) },
      },
      data: expect.objectContaining({ status: 'completed', conclusion: 'success', appName: 'GitHub Actions' }),
    })
    expect(prisma.gitCheckSuite.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }))
  })

  it('途中経過は、同じ時刻の完了済みを上書きしない', async () => {
    await handleGithubEvent(
      'check_suite',
      {
        repository: { full_name: 'owner/repo' },
        check_suite: { ...suite, status: 'in_progress', conclusion: null },
      },
      TARGET,
    )

    expect(vi.mocked(prisma.gitCheckSuite.updateMany).mock.calls[0][0].where).toEqual({
      provider: 'github',
      baseUrl: '',
      repo: 'owner/repo',
      suiteId: '99',
      repositoryId: 'r1',
      OR: [
        { syncedAt: { lt: new Date(UPDATED_AT) } },
        { syncedAt: new Date(UPDATED_AT), status: { not: 'completed' } },
      ],
    })
  })

  it('同時に届いたイベントに作成で先を越されたら、更新し直す', async () => {
    vi.mocked(prisma.gitCheckSuite.createMany).mockResolvedValue({ count: 0 })

    await handleGithubEvent('check_suite', { repository: { full_name: 'owner/repo' }, check_suite: suite }, TARGET)

    expect(prisma.gitCheckSuite.updateMany).toHaveBeenCalledTimes(2)
  })

  it('更新できたら作らない', async () => {
    vi.mocked(prisma.gitCheckSuite.updateMany).mockResolvedValue({ count: 1 })

    await handleGithubEvent('check_suite', { repository: { full_name: 'owner/repo' }, check_suite: suite }, TARGET)

    expect(prisma.gitCheckSuite.createMany).not.toHaveBeenCalled()
  })

  it('check_run は suite の状態が無ければ実行中として持つ', async () => {
    const { status: _status, conclusion: _conclusion, ...rest } = suite
    await handleGithubEvent(
      'check_run',
      {
        repository: { full_name: 'owner/repo' },
        check_run: { status: 'in_progress', app: { name: 'CI' }, check_suite: rest },
      },
      TARGET,
    )

    expect(vi.mocked(prisma.gitCheckSuite.updateMany).mock.calls[0][0].data).toMatchObject({
      status: 'in_progress',
      conclusion: null,
    })
  })

  it('受け口の対応付けと違うリポジトリの CI は保存しない', async () => {
    await handleGithubEvent('check_suite', { repository: { full_name: 'owner/other' }, check_suite: suite }, TARGET)

    expect(prisma.gitCheckSuite.updateMany).not.toHaveBeenCalled()
  })
})

describe('その他のイベント', () => {
  it('扱わないイベントは何もしない', async () => {
    await handleGithubEvent('ping', { zen: 'hello' }, TARGET)
    await handleGithubEvent('constructor', {}, TARGET)

    expect(prisma.ticketLink.updateMany).not.toHaveBeenCalled()
    expect(prisma.gitCheckSuite.updateMany).not.toHaveBeenCalled()
  })
})
