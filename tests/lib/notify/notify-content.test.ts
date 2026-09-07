/**
 * 通知の文面の単体テスト
 *
 * イベントを足しても配信側が変わらないことを支えているのがこの層なので、
 * 「何が載るか」と「リンク先がどこか」をイベントごとに固定する。
 */

import { buildNotifyContent } from '@/lib/notify/notify-content'
import type { NotifyPayload } from '@/lib/notify/notify-payload'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server-utils', () => ({
  makeUrl: (path: string) => new URL(path, 'https://devuntu.example.com'),
}))

const ticketRef = {
  ticketId: '0198c0de-0000-7000-8000-000000000001',
  displayId: 'ABC-42',
  ticketTitle: 'ログイン画面のレイアウト崩れ',
}

const mention = (override: Partial<NotifyPayload<'mention'>> = {}): NotifyPayload<'mention'> => ({
  ...ticketRef,
  fromName: 'テストユーザー',
  ...override,
})

const startedAt = new Date('2026-08-25T00:00:00Z')

const agentRun = (override: Partial<NotifyPayload<'agent_run'>> = {}): NotifyPayload<'agent_run'> => ({
  ...ticketRef,
  runId: 'run1',
  agentName: 'テストエージェント',
  action: 'execute',
  status: 'succeeded',
  startedAt,
  finishedAt: new Date(startedAt.getTime() + 90_000),
  ...override,
})

describe('buildNotifyContent: 見出しは表示IDとチケット名', () => {
  it('mention', () => {
    expect(buildNotifyContent('mention', mention(), 'ja').subject).toBe('[ABC-42] ログイン画面のレイアウト崩れ')
  })

  it('agent_run', () => {
    expect(buildNotifyContent('agent_run', agentRun(), null).subject).toBe('[ABC-42] ログイン画面のレイアウト崩れ')
  })
})

describe('buildNotifyContent: mention', () => {
  it('チケット本文のメンションは短縮URLへリンクする', () => {
    expect(buildNotifyContent('mention', mention(), 'ja').url).toBe('https://devuntu.example.com/t/ABC-42')
  })

  it('コメント経由はコメントの位置までフラグメントを付ける', () => {
    const { url } = buildNotifyContent('mention', mention({ commentId: 'comment-1' }), 'ja')
    expect(url).toBe('https://devuntu.example.com/t/ABC-42#comment-comment-1')
  })

  it('本文にメンションした人の名前が入る', () => {
    expect(buildNotifyContent('mention', mention(), 'ja').body).toContain('テストユーザー')
  })

  it('コメント経由と本文とで文面を出し分ける', () => {
    const body = buildNotifyContent('mention', mention(), 'ja').body
    const commentBody = buildNotifyContent('mention', mention({ commentId: 'comment-1' }), 'ja').body
    expect(commentBody).not.toBe(body)
  })

  it('抜粋があれば持たせ、無ければ持たせない(呼び出し側が引用行を出さずに済む)', () => {
    expect(buildNotifyContent('mention', mention({ excerpt: 'iOS だけで再現' }), 'ja').excerpt).toBe('iOS だけで再現')
    expect(buildNotifyContent('mention', mention(), 'ja')).not.toHaveProperty('excerpt')
  })
})

describe('buildNotifyContent: agent_run', () => {
  it('短縮URLではなくチケット詳細へリンクする(短縮URLはボードメンバーしか辿れない)', () => {
    expect(buildNotifyContent('agent_run', agentRun(), null).url).toBe(
      'https://devuntu.example.com/tickets/0198c0de-0000-7000-8000-000000000001',
    )
  })

  it('本文にエージェント名と所要時間が入る', () => {
    const { body } = buildNotifyContent('agent_run', agentRun(), null)
    expect(body).toContain('テストエージェント')
    expect(body, '所要時間は実行履歴と同じ mm:ss').toContain('01:30')
  })
})

describe('buildNotifyContent: ロケール', () => {
  for (const locale of ['ja', 'en', null] as const) {
    it(`${locale ?? '既定'}: 未置換のプレースホルダが残らない`, () => {
      for (const content of [
        buildNotifyContent('mention', mention({ commentId: 'comment-1' }), locale),
        buildNotifyContent('agent_run', agentRun(), locale),
      ]) {
        expect(content.subject).not.toMatch(/\$\{/)
        expect(content.body).not.toMatch(/\$\{/)
      }
    })
  }
})
