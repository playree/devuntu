/**
 * Slack への配信の単体テスト
 *
 * Slack API(`slack-server.ts`)は差し替え、宛先の決まり方と「何を載せるか」を検証する。
 * DM とチャンネルで同じ投稿処理を使うので、宛先の解決だけが分岐になる。
 */

import type { NotifyContent } from '@/lib/notify/notify-content'
import { deliverSlack } from '@/lib/notify/notify-slack'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { account: { findFirst: vi.fn() } },
}))
vi.mock('@/lib/slack/slack-server', () => ({ postSlackMessage: vi.fn(async () => 'ok') }))

const { prisma } = await import('@/lib/prisma')
const { postSlackMessage } = await import('@/lib/slack/slack-server')

const post = vi.mocked(postSlackMessage)
const findAccount = vi.mocked(prisma.account.findFirst)

const content = (override: Partial<NotifyContent> = {}): NotifyContent => ({
  subject: '[ABC-42] ログイン画面のレイアウト崩れ',
  body: 'テストエージェントが処理を終えました',
  url: 'https://devuntu.example.com/tickets/0198c0de-0000-7000-8000-000000000001',
  ...override,
})

/** 投稿されたペイロードのうち、通知バナーに出る text 部分 */
const postedText = () => (post.mock.calls[0]?.[1] as { text: string }).text

beforeEach(() => {
  vi.clearAllMocks()
  post.mockResolvedValue('ok')
})

describe('deliverSlack: 宛先の解決', () => {
  it('チャンネル宛はそのチャンネルIDへ投稿する', async () => {
    const outcome = await deliverSlack({
      userId: null,
      slackChannelId: 'C0123ABCD',
      content: content(),
      locale: null,
    })
    expect(outcome).toBe('ok')
    expect(post).toHaveBeenCalledWith('C0123ABCD', expect.objectContaining({ text: expect.any(String) }))
  })

  it('DM 宛は連携済みの Slack ユーザーIDへ投稿する', async () => {
    findAccount.mockResolvedValue({ accountId: 'U0123ABCD' } as never)
    await deliverSlack({ userId: 'user-1', slackChannelId: null, content: content(), locale: 'ja' })
    expect(post).toHaveBeenCalledWith('U0123ABCD', expect.anything())
  })

  it('連携が外れていれば送らず unlinked を返す(その配信だけ諦める)', async () => {
    findAccount.mockResolvedValue(null as never)
    const outcome = await deliverSlack({ userId: 'user-1', slackChannelId: null, content: content(), locale: 'ja' })
    expect(outcome).toBe('unlinked')
    expect(post).not.toHaveBeenCalled()
  })

  it('チャンネルIDが指定されていればアカウントは引かない', async () => {
    await deliverSlack({ userId: 'user-1', slackChannelId: 'C0123ABCD', content: content(), locale: null })
    expect(findAccount).not.toHaveBeenCalled()
  })
})

describe('deliverSlack: 送る内容', () => {
  it('見出しと本文を載せる', async () => {
    await deliverSlack({ userId: null, slackChannelId: 'C0123ABCD', content: content(), locale: null })
    const text = postedText()
    expect(text).toContain('[ABC-42] ログイン画面のレイアウト崩れ')
    expect(text).toContain('テストエージェントが処理を終えました')
  })

  it('抜粋は引用として載せる', async () => {
    await deliverSlack({
      userId: null,
      slackChannelId: 'C0123ABCD',
      content: content({ excerpt: '原因を特定して修正した' }),
      locale: null,
    })
    expect(postedText()).toContain('>原因を特定して修正した')
  })

  it('抜粋が無ければ引用行を出さない', async () => {
    await deliverSlack({ userId: null, slackChannelId: 'C0123ABCD', content: content(), locale: null })
    expect(postedText()).not.toContain('\n>')
  })

  it('ボタンは文面のURLへリンクする', async () => {
    await deliverSlack({ userId: null, slackChannelId: 'C0123ABCD', content: content(), locale: null })
    const { blocks } = post.mock.calls[0][1] as { blocks: { elements?: { url?: string }[] }[] }
    expect(blocks.at(-1)?.elements?.[0]?.url).toBe(
      'https://devuntu.example.com/tickets/0198c0de-0000-7000-8000-000000000001',
    )
  })
})
