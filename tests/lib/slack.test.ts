/**
 * Slack 通知の純粋関数の単体テスト
 *
 * `src/lib/slack-server.ts`(fetch) と `src/lib/slack-account.ts`(prisma) は
 * DB / ネットワークに依存するためテスト対象にしない。判断部分は `src/lib/slack.ts` の
 * 純粋関数へ寄せてあるので、そちらを検証する(`google-calendar-server.ts` と同じ方針)。
 */

import { NotifyEvent } from '@/generated/prisma/enums'
import { buildMentionMessage, classifySlackError, escapeSlackText, NOTIFY_EVENTS } from '@/lib/slack'
import { describe, expect, it } from 'vitest'

describe('NOTIFY_EVENTS: Prisma の enum と一致していること', () => {
  it('NotifyEvent enum と同じ値・同じ件数', () => {
    // 件数も比較することで、Prisma 側に種別を追加して NOTIFY_EVENTS の更新を忘れた場合に落ちる
    expect(NOTIFY_EVENTS, '通知設定UIの並び順は NOTIFY_EVENTS の定義順が単一ソース').toEqual(Object.values(NotifyEvent))
  })
})

describe('escapeSlackText: 利用者入力を mrkdwn の特殊記法として解釈させない', () => {
  it('& を最初に置換するので二重エスケープにならない', () => {
    // `<` を先に置換すると、生まれた `&lt;` の `&` をさらに変換して `&amp;lt;` になってしまう
    expect(escapeSlackText('<a & b>'), '& が先に処理されている').toBe('&lt;a &amp; b&gt;')
  })

  it('全体メンションを無害化する', () => {
    expect(escapeSlackText('<!channel>'), 'チケット名から全体メンションを飛ばせてはいけない').toBe('&lt;!channel&gt;')
  })

  it('ユーザーメンションを無害化する', () => {
    expect(escapeSlackText('<@U123ABC>')).toBe('&lt;@U123ABC&gt;')
  })

  it('mrkdwn の装飾記号と日本語はそのまま残す', () => {
    // Slack がエスケープを要求するのは & < > の 3 文字だけ
    expect(escapeSlackText('*太字* _斜体_ `code`')).toBe('*太字* _斜体_ `code`')
  })

  it('空文字は空文字', () => {
    expect(escapeSlackText('')).toBe('')
  })
})

describe('classifySlackError: error コードを後処理の分類へ落とす', () => {
  const cases: { error: string | undefined; expected: string; label: string }[] = [
    { error: 'channel_not_found', expected: 'unlinked', label: '宛先が見つからない' },
    { error: 'user_not_found', expected: 'unlinked', label: '宛先ユーザーが居ない' },
    { error: 'token_revoked', expected: 'revoked', label: 'トークンが失効' },
    { error: 'invalid_auth', expected: 'revoked', label: 'トークンが不正' },
    { error: 'account_inactive', expected: 'revoked', label: 'アプリが無効化' },
    { error: 'ratelimited', expected: 'rate_limited', label: 'レート制限' },
    { error: 'service_unavailable', expected: 'retryable', label: 'Slack 側の一時障害' },
    { error: 'request_timeout', expected: 'retryable', label: 'タイムアウト' },
    { error: 'invalid_blocks', expected: 'failed', label: '想定外のリクエスト' },
  ]

  for (const { error, expected, label } of cases) {
    it(`${label}(${error}) は ${expected}`, () => {
      expect(classifySlackError(error)).toBe(expected)
    })
  }

  it('未知のコードは failed に寄せて送信を止めない', () => {
    expect(classifySlackError('some_new_error_code'), '新しいコードが増えても壊れない').toBe('failed')
  })

  it('error が無い場合も failed', () => {
    expect(classifySlackError(undefined)).toBe('failed')
  })
})

describe('buildMentionMessage: chat.postMessage のペイロードを組み立てる', () => {
  const base = {
    subject: '[PRJ-12] ログイン画面のレイアウト崩れ',
    url: 'https://devuntu.example.com/t/PRJ-12',
    body: '田中太郎さんがコメントであなたをメンションしました',
    openLabel: 'チケットを開く',
  }

  it('text(フォールバック)が空にならない', () => {
    // blocks だけだと通知バナー / プッシュ通知の本文が空になる
    const res = buildMentionMessage(base)
    expect(res.text.length, '通知プレビューに使われるので必須').toBeGreaterThan(0)
    expect(res.text).toContain('[PRJ-12]')
  })

  it('section にチケットURLのリンクが入る', () => {
    const res = buildMentionMessage(base)
    expect(JSON.stringify(res.blocks)).toContain(`<${base.url}|`)
  })

  it('チケットを開くボタンに URL が入る', () => {
    const res = buildMentionMessage(base)
    expect(JSON.stringify(res.blocks)).toContain('"url":"https://devuntu.example.com/t/PRJ-12"')
  })

  it('本文の差し替えで文言が切り替わる(コメント経由かどうかは呼び出し側が決める)', () => {
    const res = buildMentionMessage({ ...base, body: '田中太郎さんがあなたをメンションしました' })
    expect(res.text).toContain('田中太郎さんがあなたをメンションしました')
  })

  it('件名の利用者入力がエスケープされる', () => {
    const res = buildMentionMessage({ ...base, subject: '[PRJ-1] <!channel> を直す' })
    const blocks = JSON.stringify(res.blocks)
    expect(blocks, 'blocks 側は必ずエスケープを通す').toContain('&lt;!channel&gt;')
    expect(blocks, '生の全体メンションが残ってはいけない').not.toContain('<!channel>')
  })

  it('3000字を超える件名は切り詰める(invalid_blocks で落ちないようにする)', () => {
    const res = buildMentionMessage({ ...base, subject: 'あ'.repeat(5000) })
    const sectionText = (res.blocks[0] as { text: { text: string } }).text.text
    expect(sectionText.length, 'Block Kit の section は 3000 字が上限').toBeLessThanOrEqual(3000)
    expect(res.text.length).toBeLessThanOrEqual(3000)
  })
})
