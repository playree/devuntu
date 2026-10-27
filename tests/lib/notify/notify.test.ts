/**
 * 通知の共通定義の単体テスト
 *
 * 設定の読み書き(`notify-setting.ts`)と配信(`notify-dispatch.ts`)は
 * DB / 外部サービスに依存するためテスト対象にしない。
 */

import { NotifyChannel, NotifyEvent } from '@/generated/prisma/enums'
import { expandTemplate } from '@/lib/locale-util'
import {
  announcementText,
  CHANNEL_NOTIFY_EVENTS,
  commentExcerpt,
  DM_NOTIFY_EVENTS,
  NOTIFY_ANNOUNCEMENT_MAX,
  NOTIFY_CHANNEL_RATE_LIMIT,
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
      // 設定画面の並びを NOTIFY_EVENTS の定義順に揃える。
      // 2つの tuple の union へ直接 includes すると引数が共通要素型に絞られるため、
      // 下の「どちらの宛先にも出ないイベント」と同じく Set で判定する
      const target = new Set<string>(events)
      expect([...events]).toEqual(NOTIFY_EVENTS.filter((event) => target.has(event)))
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

  it('全チャネルに 1 tick の上限とスロットルがある', () => {
    // 指定漏れは undefined が LIMIT へ渡って配信が止まるので、キーの網羅を固定する
    expect(Object.keys(NOTIFY_DELIVER_BATCH).sort()).toEqual([...NOTIFY_CHANNELS].sort())
    expect(Object.keys(NOTIFY_CHANNEL_RATE_LIMIT).sort()).toEqual([...NOTIFY_CHANNELS].sort())
  })

  it('チャネル名は UserNotifySetting の列名としても使える', () => {
    // `filterNotifiable` が `[channel]: true` で列を引くので、列名とずれると絞り込みが壊れる
    expect(NOTIFY_CHANNELS).toEqual(['email', 'slack', 'webpush'])
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
    expect(commentExcerpt('<<b>script>alert(1)'), '外した結果できたタグも落とす').toBe('alert(1)')
    expect(commentExcerpt('a < b'), 'タグでない < は残す').toBe('a < b')
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

describe('announcementText: アナウンスとして Slack に載せる本文', () => {
  it('改行と箇条書きを残し、空行の連続は 1 つに畳む', () => {
    expect(announcementText('## v1.0.0\n\n\n\n* 機能A\n- 機能B\n  + 入れ子\n1. 番号付き')).toBe(
      'v1.0.0\n\n• 機能A\n• 機能B\n  • 入れ子\n1. 番号付き',
    )
  })

  it('強調・引用・区切り線の記号は落とす', () => {
    expect(announcementText('**重要** な _お知らせ_\n> 引用\n\n---\n\n以上')).toBe('重要 な _お知らせ_\n引用\n\n以上')
  })

  it('リンクは URL を残す。ラベルと同じなら URL だけ、相対パスはラベルだけ', () => {
    expect(announcementText('[リリースノート](https://example.com/r/v1 "title")')).toBe(
      'リリースノート (https://example.com/r/v1)',
    )
    expect(announcementText('[https://example.com/a](https://example.com/a)')).toBe('https://example.com/a')
    expect(announcementText('<https://example.com/b> を参照')).toBe('https://example.com/b を参照')
    expect(announcementText('[チケット](/t/PRJ-1) を参照')).toBe('チケット を参照')
  })

  it('URL 中の強調・エスケープに見える記号は落とさない', () => {
    expect(announcementText('[init](https://example.com/pkg/__init__.py) と <https://example.com/a*b~~c>')).toBe(
      'init (https://example.com/pkg/__init__.py) と https://example.com/a*b~~c',
    )
  })

  it('画像はラベルだけにする', () => {
    expect(announcementText('![スクショ](https://example.com/a.webp)')).toBe('スクショ')
  })

  it('生HTMLのタグは落とす', () => {
    expect(announcementText('<u>お知らせ</u>\n<<b>script>alert(1)')).toBe('お知らせ\nalert(1)')
    expect(announcementText('a < b'), 'タグでない < は残す').toBe('a < b')
  })

  it('コードは囲みを Slack のコードに置き換えて中身を残す', () => {
    expect(announcementText('手順\n\n```sh\ndocker compose pull\n```\n`pnpm migrate` を実行')).toBe(
      '手順\n\n`docker compose pull`\n`pnpm migrate` を実行',
    )
  })

  it('コードの中身には記法の除去をかけない(Slack が書式として読まないようコードとして囲む)', () => {
    expect(announcementText('`Array<string>` と `**/*.ts` と `a  b`')).toBe('`Array<string>` と `**/*.ts` と `a  b`')
    expect(announcementText('```md\n# 見出しではない\n- old\n\n  **字下げ**\n```\n以上')).toBe(
      '`# 見出しではない`\n`- old`\n\n  `**字下げ**`\n以上',
    )
  })

  it('バッククォートを含むコードは三重のバッククォートで囲む', () => {
    expect(announcementText('``a `b` c``')).toBe('```a `b` c```')
  })

  it('開始と違う文字を含む行ではコードブロックを閉じない', () => {
    expect(announcementText('```\n**a**\n```~\n- b\n```\n**c**')).toBe('`**a**`\n```~\n`- b`\nc')
  })

  it('閉じていないコードブロックは末尾までをコードとして残す', () => {
    expect(announcementText('手順\n```\n- a\n- b')).toBe('手順\n`- a`\n`- b`')
  })

  it('情報文字列にバッククォートを含む行はコードブロックの開始にしない', () => {
    expect(announcementText('```js```\n**太字**\n- item')).toBe('`js`\n太字\n• item')
  })

  it('対になっていないバッククォートは落とし、エスケープされたものは記号として残す', () => {
    expect(announcementText('a ` b')).toBe('a b')
    expect(announcementText('a \\`b\\` c')).toBe('a `b` c')
  })

  it('本文に直接書いた URL は記号を落とさず、末尾の句読点・強調・対にならない括弧は外す', () => {
    expect(announcementText('https://example.com/pkg/__init__.py を参照')).toBe(
      'https://example.com/pkg/__init__.py を参照',
    )
    expect(announcementText('**https://example.com/a** と (https://example.com/b)。')).toBe(
      'https://example.com/a と (https://example.com/b)。',
    )
    expect(announcementText('https://example.com/wiki/A_(b) と https://example.com/c.')).toBe(
      'https://example.com/wiki/A_(b) と https://example.com/c.',
    )
    expect(announcementText('https://example.com/a\\_b')).toBe('https://example.com/a_b')
  })

  it('URL の直後の文字参照は URL に含めず、実体へ戻す', () => {
    expect(announcementText('https://example.com/a&#x20;\n次の行')).toBe('https://example.com/a\n次の行')
  })

  it('閉じ括弧が大量に続いても線形で終わる', () => {
    const started = performance.now()
    expect(announcementText(`https://a${')'.repeat(39_990)}`, new Map(), 20)).toHaveLength(20)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('エスケープされた `\\<URL>` もバックスラッシュを残さず URL にする', () => {
    expect(announcementText('\\<https://example.com/a__b__c> を参照')).toBe('https://example.com/a__b__c を参照')
  })

  it('コード内のメンションもメールアドレスのまま出さない', () => {
    const names = new Map([['foo@example.com', 'テストユーザー']])
    expect(announcementText('`@[foo@example.com]` に依頼', names)).toBe('`@テストユーザー` に依頼')
  })

  it('メンションは `@表示名` にする', () => {
    const names = new Map([['foo@example.com', 'テストユーザー']])
    expect(announcementText('@[foo@example.com] おつかれさまです', names)).toBe('@テストユーザー おつかれさまです')
  })

  it('行中の空白は畳み、行頭の字下げは残す', () => {
    expect(announcementText('a   b&#x20;\n\t- c')).toBe('a b\n  • c')
  })

  it('上限で切り詰める', () => {
    const text = announcementText('あ'.repeat(NOTIFY_ANNOUNCEMENT_MAX + 10))
    expect(text).toHaveLength(NOTIFY_ANNOUNCEMENT_MAX)
    expect(text.endsWith('…')).toBe(true)
  })

  it('記法だけの本文は空文字になる', () => {
    expect(announcementText('***')).toBe('')
  })
})
