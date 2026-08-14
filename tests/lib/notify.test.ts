/**
 * 通知の共通定義の単体テスト
 *
 * 設定の読み書き(`src/lib/notify-setting.ts`)と送信(`src/lib/notify-mention.ts`)は
 * DB / 外部サービスに依存するためテスト対象にしない。
 */

import { NotifyEvent } from '@/generated/prisma/enums'
import { expandTemplate } from '@/lib/locale-util'
import { NOTIFY_CHANNELS, NOTIFY_EVENTS } from '@/lib/notify'
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
