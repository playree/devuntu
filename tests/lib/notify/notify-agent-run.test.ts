/**
 * エージェント実行結果のチャンネル通知の単体テスト
 *
 * Slack API(`slack-server.ts`)と管理者設定(`slack-account.ts`)は差し替え、
 * 「どういうときに送らないか」と「何を載せるか」だけを検証する。
 * `after()` は本番ではレスポンス後に走るが、ここでは即時実行にして結果を見る。
 */

import { notifyAgentRun, type AgentRunNotification } from '@/lib/notify/notify-agent-run'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/server', () => ({ after: (fn: () => unknown) => fn() }))
vi.mock('@/lib/server-utils', () => ({
  makeUrl: (path: string) => new URL(path, 'https://devuntu.example.com'),
}))
vi.mock('@/lib/slack/slack-account', () => ({
  hasSlackCredentials: vi.fn(() => true),
  getSlackSettings: vi.fn(async () => ({ enabled: true, allowedGroupIds: [] })),
}))
vi.mock('@/lib/slack/slack-server', () => ({ postSlackMessage: vi.fn(async () => 'ok') }))

const { hasSlackCredentials, getSlackSettings } = await import('@/lib/slack/slack-account')
const { postSlackMessage } = await import('@/lib/slack/slack-server')

const post = vi.mocked(postSlackMessage)
const credentials = vi.mocked(hasSlackCredentials)
const settings = vi.mocked(getSlackSettings)

const startedAt = new Date('2026-08-25T00:00:00Z')

const notification = (override: Partial<AgentRunNotification> = {}): AgentRunNotification => ({
  slackChannelId: 'C0123ABCD',
  runId: 'run1',
  agentName: 'テストエージェント',
  ticketId: '0198c0de-0000-7000-8000-000000000001',
  displayId: 'ABC-42',
  ticketTitle: 'ログイン画面のレイアウト崩れ',
  action: 'execute',
  status: 'succeeded',
  summary: '原因を特定して修正した',
  startedAt,
  finishedAt: new Date(startedAt.getTime() + 90_000),
  ...override,
})

/** 投稿されたペイロードのうち、通知バナーに出る text 部分 */
const postedText = () => (post.mock.calls[0]?.[1] as { text: string }).text

beforeEach(() => {
  vi.clearAllMocks()
  credentials.mockReturnValue(true)
  settings.mockResolvedValue({ enabled: true, allowedGroupIds: [] })
})

describe('notifyAgentRun: 送らない条件', () => {
  it('チャンネル未設定のボードには送らない', async () => {
    await notifyAgentRun(notification({ slackChannelId: null }))
    expect(post).not.toHaveBeenCalled()
  })

  it('環境変数が揃っていなければ送らない', async () => {
    credentials.mockReturnValue(false)
    await notifyAgentRun(notification())
    expect(post).not.toHaveBeenCalled()
  })

  it('管理者が Slack 連携を無効にしていれば送らない', async () => {
    settings.mockResolvedValue({ enabled: false, allowedGroupIds: [] })
    await notifyAgentRun(notification())
    expect(post).not.toHaveBeenCalled()
  })

  it('Slack が失敗しても呼び出し元へ例外を伝えない', async () => {
    post.mockRejectedValueOnce(new Error('boom'))
    await expect(notifyAgentRun(notification())).resolves.toBeUndefined()
  })
})

describe('notifyAgentRun: 送る内容', () => {
  it('設定されたチャンネルへ投稿する', async () => {
    await notifyAgentRun(notification())
    expect(post).toHaveBeenCalledWith('C0123ABCD', expect.objectContaining({ text: expect.any(String) }))
  })

  it('見出しは表示IDとチケット名', async () => {
    await notifyAgentRun(notification())
    expect(postedText()).toContain('[ABC-42] ログイン画面のレイアウト崩れ')
  })

  it('本文にエージェント名・処理・結果・所要時間が入る', async () => {
    await notifyAgentRun(notification())
    const text = postedText()
    expect(text).toContain('テストエージェント')
    expect(text, '所要時間は履歴と同じ mm:ss').toContain('01:30')
  })

  it('報告の要約を引用として載せる', async () => {
    await notifyAgentRun(notification())
    expect(postedText()).toContain('>原因を特定して修正した')
  })

  it('要約が無ければ引用行を出さない', async () => {
    await notifyAgentRun(notification({ summary: null }))
    expect(postedText()).not.toContain('\n>')
  })

  it('記法だけの要約は引用行にしない(落とすと空になるため)', async () => {
    await notifyAgentRun(notification({ summary: '**' }))
    expect(postedText()).not.toContain('\n>')
  })

  it('チケット詳細へリンクする(短縮URLはボードメンバーしか辿れない)', async () => {
    await notifyAgentRun(notification())
    const { blocks } = post.mock.calls[0][1] as { blocks: { elements?: { url?: string }[] }[] }
    expect(blocks.at(-1)?.elements?.[0]?.url).toBe(
      'https://devuntu.example.com/tickets/0198c0de-0000-7000-8000-000000000001',
    )
  })
})
