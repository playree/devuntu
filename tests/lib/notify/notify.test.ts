/**
 * 通知の共通定義の単体テスト
 *
 * 設定の読み書き(`src/lib/notify-setting.ts`)と送信(`src/lib/notify-mention.ts`)は
 * DB / 外部サービスに依存するためテスト対象にしない。
 */

import { NotifyEvent } from '@/generated/prisma/enums'
import { expandTemplate } from '@/lib/locale-util'
import { commentExcerpt, NOTIFY_CHANNELS, NOTIFY_EVENTS, NOTIFY_EXCERPT_MAX } from '@/lib/notify/notify'
import { en } from '@/locale/lang-en'
import { ja } from '@/locale/lang-ja'
import { describe, expect, it } from 'vitest'

describe('NOTIFY_EVENTS: Prisma の enum と一致していること', () => {
  it('NotifyEvent enum と同じ値・同じ件数', () => {
    // 件数も比較することで、Prisma 側に種別を追加して NOTIFY_EVENTS の更新を忘れた場合に落ちる
    expect(NOTIFY_EVENTS, '通知設定UIの並び順は NOTIFY_EVENTS の定義順が単一ソース').toEqual(Object.values(NotifyEvent))
  })
})

describe('NOTIFY_CHANNELS: UserNotifySetting の列名と一致していること', () => {
  it('メールと Slack の 2 チャネル', () => {
    // 列名をそのままキーに使うので、ここがずれると設定の保存先を取り違える
    expect(NOTIFY_CHANNELS).toEqual(['email', 'slack'])
  })
})

describe('mail_mention_body: メンション通知メールの本文', () => {
  const values = {
    message: '田中太郎さんがコメントであなたをメンションしました',
    subject: '[PRJ-12] ログイン画面のレイアウト崩れ',
    url: 'https://devuntu.example.com/t/PRJ-12',
  }

  for (const [lang, resources] of [
    ['ja', ja],
    ['en', en],
  ] as const) {
    it(`${lang}: 全てのプレースホルダが値で埋まる`, () => {
      // テンプレートリテラルで書くため `\${...}` のエスケープを落とすと実評価されて空になる
      const body = expandTemplate(resources.mail_mention_body ?? '', values)
      expect(body).toContain(values.message)
      expect(body).toContain(values.subject)
      expect(body).toContain(values.url)
      expect(body, '未置換のプレースホルダが残っていない').not.toMatch(/\$\{/)
    })
  }
})

describe('mail_mention_comment_body: コメント経由のメンション通知メールの本文', () => {
  const values = {
    message: '田中太郎さんがコメントであなたをメンションしました',
    subject: '[PRJ-12] ログイン画面のレイアウト崩れ',
    excerpt: 'iOS Safari だけで再現しました',
    url: 'https://devuntu.example.com/t/PRJ-12#comment-0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  }

  for (const [lang, resources] of [
    ['ja', ja],
    ['en', en],
  ] as const) {
    it(`${lang}: 全てのプレースホルダが値で埋まる`, () => {
      const body = expandTemplate(resources.mail_mention_comment_body ?? '', values)
      expect(body).toContain(values.message)
      expect(body).toContain(values.subject)
      expect(body, 'コメント内容を届けるのがこの本文の目的').toContain(values.excerpt)
      expect(body).toContain(values.url)
      expect(body, '未置換のプレースホルダが残っていない').not.toMatch(/\$\{/)
    })
  }
})

describe('commentExcerpt: 通知に載せるコメント本文の抜粋', () => {
  it('改行を畳んで 1 行にする', () => {
    // Slack の引用は 1 行で出すため、段落やリストの改行をそのまま残さない
    expect(commentExcerpt('一行目\n\n二行目\n三行目')).toBe('一行目 二行目 三行目')
  })

  it('コードブロック / インラインコードは落とす', () => {
    expect(commentExcerpt('修正しました\n\n```ts\nconst a = 1\n```')).toBe('修正しました')
    expect(commentExcerpt('`npm run build` が通りません')).toBe('が通りません')
  })

  it('画像とリンクは URL を残さずラベルだけにする', () => {
    expect(commentExcerpt('![スクショ](https://example.com/a.webp) を見てください')).toBe('スクショ を見てください')
    expect(commentExcerpt('[チケット](https://example.com/t/PRJ-1) を参照')).toBe('チケット を参照')
  })

  it('メンションは画面と同じ `@表示名` にする', () => {
    const names = new Map([['foo@example.com', 'テストユーザー']])
    expect(commentExcerpt('@[foo@example.com] 確認おねがいします', names)).toBe('@テストユーザー 確認おねがいします')
    // Markdown のエスケープを通った形(素のテキストとして書かれた場合)も同じ扱い
    expect(commentExcerpt('@\\[foo@example.com] おねがいします', names)).toBe('@テストユーザー おねがいします')
  })

  it('名前が引けないメンションはメールアドレスのまま出す(画面のフォールバックと同じ)', () => {
    expect(commentExcerpt('@[foo@example.com] 確認おねがいします')).toBe('@foo@example.com 確認おねがいします')
  })

  it('メールアドレスの直後の角括弧はメンションとして拾わない', () => {
    // 記法の判定を findMentions に任せているので、task.ts の前置ルールがそのまま効く
    expect(commentExcerpt('a@b.com@[foo@example.com] です')).toBe('a@b.com@[foo@example.com] です')
  })

  it('見出し / 引用 / リストのマーカーと強調記号を落とす', () => {
    expect(commentExcerpt('## 調査結果\n- **原因** は CSS\n- 対処済み')).toBe('調査結果 原因 は CSS 対処済み')
  })

  it('文字参照を実体へ戻す', () => {
    // メンション挿入時の空白が段落末尾に来ると、MDXEditor の書き出しが &#x20; にする
    const names = new Map([['foo@example.com', 'テストユーザー']])
    expect(commentExcerpt('@[foo@example.com]&#x20;\n\nmentionてすと', names)).toBe('@テストユーザー mentionてすと')
    expect(commentExcerpt('A &amp; B'), '名前付き').toBe('A & B')
    expect(commentExcerpt('&#12354; と &#x1F600;'), '10進 / サロゲートペア').toBe('あ と 😀')
  })

  it('読めない文字参照は原文のまま残す(壊れた文字にするより原文の方がまし)', () => {
    expect(commentExcerpt('&#xZZ; と &copy; と &#xD800;')).toBe('&#xZZ; と &copy; と &#xD800;')
  })

  it('バックスラッシュエスケープを外す', () => {
    expect(commentExcerpt('\\[リンクではない]')).toBe('[リンクではない]')
    expect(commentExcerpt('2 \\* 3'), '記号として書かれた * は残す').toBe('2 * 3')
  })

  it('生HTMLのタグは落とす', () => {
    expect(commentExcerpt('<u>comment</u>')).toBe('comment')
    expect(commentExcerpt('<img height="173" src="/api/upload/x.webp" />\n\ntest')).toBe('test')
  })

  it('上限を超えたら省略記号を付ける', () => {
    const excerpt = commentExcerpt('あ'.repeat(NOTIFY_EXCERPT_MAX + 100))
    expect(excerpt.length).toBe(NOTIFY_EXCERPT_MAX)
    expect(excerpt.endsWith('…'), '途中で切れたことが分かるようにする').toBe(true)
  })

  it('記法だけの本文は空文字になる(呼び出し側が抜粋なしとして扱える)', () => {
    expect(commentExcerpt('![](https://example.com/a.webp)')).toBe('')
    expect(commentExcerpt('   ')).toBe('')
  })
})
