/**
 * エージェント実行結果通知の単体テスト
 *
 * この入口が行うのはキューへの投入まで(送信は配信ワーカー)。
 * 「送らない条件」と「投入時に確定させる内容」を検証する。
 * 投稿の中身は `notify-content.test.ts` / `notify-slack.test.ts` で見る。
 */

import { notifyAgentRun, type AgentRunNotification } from '@/lib/notify/notify-agent-run'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/notify/notify-enqueue', () => ({ enqueueNotify: vi.fn(async () => undefined) }))

const { enqueueNotify } = await import('@/lib/notify/notify-enqueue')
const enqueue = vi.mocked(enqueueNotify)

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

/** 投入されたアウトボックスの内容 */
const enqueued = () => enqueue.mock.calls[0][0]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('notifyAgentRun: 送らない条件', () => {
  it('チャンネル未設定のボードには投入しない', async () => {
    await notifyAgentRun(notification({ slackChannelId: null }))
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('notifyAgentRun: 投入する内容', () => {
  it('設定されたチャンネルを宛先にする', async () => {
    await notifyAgentRun(notification())
    expect(enqueued()).toMatchObject({ event: 'agent_run', targetSlackChannelIds: ['C0123ABCD'] })
  })

  it('宛先はチャンネルだけ(ユーザーの通知設定とは独立している)', async () => {
    await notifyAgentRun(notification())
    expect(enqueued().targetUserIds).toBeUndefined()
  })

  it('文面に必要な値をスナップショットする(配信時にチケットが消えていても組み立てられる)', async () => {
    await notifyAgentRun(notification())
    expect(enqueued().payload).toMatchObject({
      ticketId: '0198c0de-0000-7000-8000-000000000001',
      displayId: 'ABC-42',
      ticketTitle: 'ログイン画面のレイアウト崩れ',
      agentName: 'テストエージェント',
      action: 'execute',
      status: 'succeeded',
      startedAt,
    })
  })

  it('要約は記法を落とした抜粋にする', async () => {
    await notifyAgentRun(notification({ summary: '## 調査結果\n- **原因** は CSS' }))
    expect(enqueued().payload).toMatchObject({ excerpt: '調査結果 原因 は CSS' })
  })

  it('要約が無ければ抜粋を持たせない', async () => {
    await notifyAgentRun(notification({ summary: null }))
    expect(enqueued().payload).not.toHaveProperty('excerpt')
  })

  it('記法だけの要約は抜粋にしない(落とすと空になるため)', async () => {
    await notifyAgentRun(notification({ summary: '**' }))
    expect(enqueued().payload).not.toHaveProperty('excerpt')
  })
})
