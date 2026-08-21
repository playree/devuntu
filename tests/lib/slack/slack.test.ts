/**
 * Slack 通知の純粋関数の単体テスト
 *
 * `src/lib/slack-server.ts`(fetch) と `src/lib/slack-account.ts`(prisma) は
 * DB / ネットワークに依存するためテスト対象にしない。判断部分は `src/lib/slack.ts` の
 * 純粋関数へ寄せてあるので、そちらを検証する(`google-calendar-server.ts` と同じ方針)。
 */

import { buildMentionMessage, buildTicketUnfurlBlocks, classifySlackError, escapeSlackText } from '@/lib/slack/slack'
import { describe, expect, it } from 'vitest'

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
    { error: 'not_in_channel', expected: 'unlinked', label: 'Bot がチャンネルに参加していない' },
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
    // text は通知プレビューに使われるため、blocks と同じくエスケープ済みでなければならない
    expect(res.text, 'フォールバックの text にも生の全体メンションを残さない').not.toContain('<!channel>')
  })

  it('3000字を超える件名は切り詰める(invalid_blocks で落ちないようにする)', () => {
    const res = buildMentionMessage({ ...base, subject: 'あ'.repeat(5000) })
    const sectionText = (res.blocks[0] as { text: { text: string } }).text.text
    expect(sectionText.length, 'Block Kit の section は 3000 字が上限').toBeLessThanOrEqual(3000)
    expect(res.text.length).toBeLessThanOrEqual(3000)
    // 件名だけで上限に達しても、リンク記法は閉じたままにする
    expect(sectionText.startsWith(`*<${base.url}|`), '開きが残る').toBe(true)
    expect(sectionText).toContain('>*')
  })

  it('本文が長くてもリンク記法は壊さない', () => {
    const res = buildMentionMessage({ ...base, body: 'い'.repeat(5000) })
    const sectionText = (res.blocks[0] as { text: { text: string } }).text.text
    expect(sectionText.length).toBeLessThanOrEqual(3000)
    // 切り詰めの対象は本文側。見出しのリンクは丸ごと残る
    expect(sectionText.startsWith(`*<${base.url}|${base.subject}>*\n`)).toBe(true)
  })

  it('抜粋が引用として本文の下に入る', () => {
    const res = buildMentionMessage({ ...base, excerpt: 'iOS Safari だけで再現しました' })
    const sectionText = (res.blocks[0] as { text: { text: string } }).text.text
    expect(sectionText, 'mrkdwn の引用にして本文と区別する').toContain('\n>iOS Safari だけで再現しました')
    // 抜粋を届けるのが目的なので、プッシュ通知の時点で内容が見えるようにする
    expect(res.text).toContain('iOS Safari だけで再現しました')
  })

  it('抜粋が無い場合は引用行を作らない', () => {
    const res = buildMentionMessage(base)
    const sectionText = (res.blocks[0] as { text: { text: string } }).text.text
    expect(sectionText).toBe(`*<${base.url}|${base.subject}>*\n${base.body}`)
  })

  it('抜粋の利用者入力がエスケープされる', () => {
    const res = buildMentionMessage({ ...base, excerpt: '<!channel> 見てください' })
    expect(JSON.stringify(res.blocks)).not.toContain('<!channel>')
    expect(res.text, 'フォールバックの text にも生の全体メンションを残さない').not.toContain('<!channel>')
  })

  it('本文で予算を使い切ったら抜粋を落とす(壊れた記法より欠落を選ぶ)', () => {
    const res = buildMentionMessage({ ...base, body: 'い'.repeat(5000), excerpt: 'う'.repeat(500) })
    const sectionText = (res.blocks[0] as { text: { text: string } }).text.text
    expect(sectionText.length).toBeLessThanOrEqual(3000)
    expect(sectionText.startsWith(`*<${base.url}|${base.subject}>*\n`)).toBe(true)
    expect(sectionText, '入り切らない抜粋は行ごと落とす').not.toContain('\n>')
  })
})

describe('buildTicketUnfurlBlocks: chat.unfurl のプレビューを組み立てる', () => {
  const base = {
    url: 'https://devuntu.example.com/t/PRJ-12',
    displayId: 'PRJ-12',
    title: 'ログイン画面のレイアウト崩れ',
    fields: [
      { label: 'ステータス', value: '対応中' },
      { label: '優先度', value: '高' },
      { label: '担当者', value: '田中太郎' },
      { label: '期限', value: '2026-08-31' },
    ],
  }

  /** section の fields を取り出す(fields が無ければ空配列) */
  const fieldsOf = (blocks: unknown[]) =>
    (blocks[1] as { fields?: { text: string }[] } | undefined)?.fields?.map(({ text }) => text) ?? []

  it('見出しにチケットURLのリンクと表示IDが入る', () => {
    const blocks = buildTicketUnfurlBlocks(base)
    const heading = (blocks[0] as { text: { text: string } }).text.text
    expect(heading).toBe('*<https://devuntu.example.com/t/PRJ-12|[PRJ-12] ログイン画面のレイアウト崩れ>*')
  })

  it('渡した項目が section の fields に並ぶ', () => {
    expect(fieldsOf(buildTicketUnfurlBlocks(base))).toEqual([
      '*ステータス*\n対応中',
      '*優先度*\n高',
      '*担当者*\n田中太郎',
      '*期限*\n2026-08-31',
    ])
  })

  it('値が空の項目は落とす(未設定の担当者・期限で空欄を出さない)', () => {
    const blocks = buildTicketUnfurlBlocks({
      ...base,
      fields: [
        { label: 'ステータス', value: '対応予定' },
        { label: '担当者', value: '' },
        { label: '期限', value: '' },
      ],
    })
    expect(fieldsOf(blocks)).toEqual(['*ステータス*\n対応予定'])
  })

  it('項目が 1 つも無ければ fields の section 自体を作らない', () => {
    // 空の fields を持つ section は invalid_blocks になる
    const blocks = buildTicketUnfurlBlocks({ ...base, fields: [] })
    expect(blocks).toHaveLength(1)
  })

  it('チケット名の利用者入力がエスケープされる', () => {
    const blocks = buildTicketUnfurlBlocks({ ...base, title: '<!channel> を直す' })
    const json = JSON.stringify(blocks)
    expect(json).toContain('&lt;!channel&gt;')
    expect(json, 'チャンネル全員に見えるので生の全体メンションを残さない').not.toContain('<!channel>')
  })

  it('担当者名の利用者入力もエスケープされる', () => {
    const blocks = buildTicketUnfurlBlocks({
      ...base,
      fields: [{ label: '担当者', value: '<@U123ABC>' }],
    })
    expect(fieldsOf(blocks)).toEqual(['*担当者*\n&lt;@U123ABC&gt;'])
  })

  it('3000字を超える見出しは切り詰め、リンク記法は壊さない', () => {
    const blocks = buildTicketUnfurlBlocks({ ...base, title: 'あ'.repeat(5000) })
    const heading = (blocks[0] as { text: { text: string } }).text.text
    expect(heading.length).toBeLessThanOrEqual(3000)
    // 組み立ててから切ると閉じの `>*` が落ちてリンクが崩れる
    expect(heading.startsWith(`*<${base.url}|`), '開きが残る').toBe(true)
    expect(heading.endsWith('>*'), '閉じが残る').toBe(true)
  })

  it('10 件を超える項目は切り捨てる(fields の上限)', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ label: `l${i}`, value: `v${i}` }))
    expect(fieldsOf(buildTicketUnfurlBlocks({ ...base, fields: many }))).toHaveLength(10)
  })
})
