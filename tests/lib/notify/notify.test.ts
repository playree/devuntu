/**
 * 通知の共通定義の単体テスト
 *
 * 設定の読み書き(`notify-setting.ts`)と配信(`notify-dispatch.ts`)は
 * DB / 外部サービスに依存するためテスト対象にしない。
 */

import { NotifyChannel, NotifyEvent } from '@/generated/prisma/enums'
import { expandTemplate } from '@/lib/locale-util'
import {
  CHANNEL_NOTIFY_EVENTS,
  commentExcerpt,
  DM_NOTIFY_EVENTS,
  NOTIFY_CHANNELS,
  NOTIFY_DELIVER_BATCH,
  NOTIFY_EVENTS,
  NOTIFY_EXCERPT_MAX,
} from '@/lib/notify/notify'
import { en } from '@/locale/lang-en'
import { ja } from '@/locale/lang-ja'
import { describe, expect, it } from 'vitest'

describe('NOTIFY_EVENTS: Prisma の enum と一致していること', () => {
  it('NotifyEvent enum と同じ値・同じ件数', () => {
    // 件数も比較することで、Prisma 側に種別を追加して NOTIFY_EVENTS の更新を忘れた場合に落ちる
    expect(NOTIFY_EVENTS, '通知設定UIの並び順は NOTIFY_EVENTS の定義順が単一ソース').toEqual(Object.values(NotifyEvent))
  })
})

describe('DM_NOTIFY_EVENTS / CHANNEL_NOTIFY_EVENTS: 宛先ごとの内訳', () => {
  for (const [label, events] of [
    ['DM_NOTIFY_EVENTS', DM_NOTIFY_EVENTS],
    ['CHANNEL_NOTIFY_EVENTS', CHANNEL_NOTIFY_EVENTS],
  ] as const) {
    it(`${label} は NOTIFY_EVENTS の部分集合`, () => {
      // 設定画面はここから項目を作るので、enum に無い値が混ざるとロケールキーも引けなくなる
      expect(events.every((event) => NOTIFY_EVENTS.includes(event))).toBe(true)
    })

    it(`${label} は定義順が NOTIFY_EVENTS と同じ`, () => {
      // 設定画面の並びを NOTIFY_EVENTS の定義順に揃える
      expect([...events]).toEqual(NOTIFY_EVENTS.filter((event) => events.includes(event)))
    })
  }

  it('どちらの宛先にも出ないイベントは無い(設定できない通知を作らない)', () => {
    const covered = new Set<string>([...DM_NOTIFY_EVENTS, ...CHANNEL_NOTIFY_EVENTS])
    expect(NOTIFY_EVENTS.filter((event) => !covered.has(event))).toEqual([])
  })

  it('設定画面に出る全イベントに項目名がある', () => {
    // 設定画面(`/account` とボード設定)は `notify_event_<event>` でラベルを引くので、
    // キーが無いとイベント名が出ない
    for (const event of [...DM_NOTIFY_EVENTS, ...CHANNEL_NOTIFY_EVENTS]) {
      expect(ja[`notify_event_${event}`], `ja: notify_event_${event}`).toBeTruthy()
      expect(en[`notify_event_${event}`], `en: notify_event_${event}`).toBeTruthy()
    }
  })
})

describe('NOTIFY_CHANNELS: Prisma の enum / UserNotifySetting の列名と一致していること', () => {
  it('NotifyChannel enum と同じ値・同じ件数', () => {
    // 列名をそのままキーに使うので、ここがずれると設定の保存先を取り違える
    expect(NOTIFY_CHANNELS).toEqual(Object.values(NotifyChannel))
  })

  it('全チャネルに 1 tick の上限がある', () => {
    // 上限の指定漏れは undefined が LIMIT へ渡って配信が止まるので、キーの網羅を固定する
    expect(Object.keys(NOTIFY_DELIVER_BATCH).sort()).toEqual([...NOTIFY_CHANNELS].sort())
  })
})

describe('mail_notify_body: 通知メールの本文(1件)', () => {
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
      const body = expandTemplate(resources.mail_notify_body ?? '', values)
      expect(body).toContain(values.message)
      expect(body).toContain(values.subject)
      expect(body).toContain(values.url)
      expect(body, '未置換のプレースホルダが残っていない').not.toMatch(/\$\{/)
    })
  }
})

describe('mail_notify_excerpt_body: 抜粋付きの通知メールの本文(1件)', () => {
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
      const body = expandTemplate(resources.mail_notify_excerpt_body ?? '', values)
      expect(body).toContain(values.message)
      expect(body).toContain(values.subject)
      expect(body, 'コメント内容を届けるのがこの本文の目的').toContain(values.excerpt)
      expect(body).toContain(values.url)
      expect(body, '未置換のプレースホルダが残っていない').not.toMatch(/\$\{/)
    })
  }
})

describe('mail_digest_*: まとめた通知メールのテンプレート', () => {
  for (const [lang, resources] of [
    ['ja', ja],
    ['en', en],
  ] as const) {
    it(`${lang}: 件名に件数が入る`, () => {
      const subject = expandTemplate(resources.mail_digest_subject ?? '', { appname: 'Devuntu', count: 3 })
      expect(subject).toContain('Devuntu')
      expect(subject).toContain('3')
      expect(subject, '未置換のプレースホルダが残っていない').not.toMatch(/\$\{/)
    })

    it(`${lang}: 本文に件数と項目が入る`, () => {
      const body = expandTemplate(resources.mail_digest_body ?? '', { count: 3, items: '項目のテスト' })
      expect(body).toContain('3')
      expect(body).toContain('項目のテスト')
      expect(body, '未置換のプレースホルダが残っていない').not.toMatch(/\$\{/)
    })

    it(`${lang}: 項目は抜粋の有無で 2 種類`, () => {
      const values = {
        message: '田中太郎さんがあなたをメンションしました',
        subject: '[PRJ-12] ログイン画面のレイアウト崩れ',
        excerpt: 'iOS Safari だけで再現しました',
        url: 'https://devuntu.example.com/t/PRJ-12',
      }
      const item = expandTemplate(resources.mail_digest_item ?? '', values)
      expect(item).toContain(values.message)
      expect(item).toContain(values.subject)
      expect(item).toContain(values.url)
      expect(item, '抜粋なしの項目には抜粋を出さない').not.toContain(values.excerpt)
      expect(item).not.toMatch(/\$\{/)

      const withExcerpt = expandTemplate(resources.mail_digest_item_excerpt ?? '', values)
      expect(withExcerpt).toContain(values.excerpt)
      expect(withExcerpt).not.toMatch(/\$\{/)
    })

    it(`${lang}: 畳んだ分は件数だけを示す`, () => {
      const more = expandTemplate(resources.mail_digest_more ?? '', { count: 5 })
      expect(more).toContain('5')
      expect(more).not.toMatch(/\$\{/)
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
