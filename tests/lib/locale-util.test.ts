/** サーバー / クライアント双方の `t()` が共有する実装なので、置換規則をここで固定する */

import { expandTemplate, pickFallbackLocale, pickLocale, type LocaleConfig } from '@/lib/locale-util'
import { describe, expect, it } from 'vitest'

describe('expandTemplate', () => {
  it('values を渡さなければテンプレートをそのまま返す', () => {
    expect(expandTemplate('${target} を削除しました。')).toBe('${target} を削除しました。')
  })

  it('プレースホルダを値で置換する', () => {
    expect(expandTemplate('${target} を削除しました。', { target: 'タグ' })).toBe('タグ を削除しました。')
  })

  it('同じキーが複数あればすべて置換する', () => {
    expect(expandTemplate('${a}-${a}', { a: 1 })).toBe('1-1')
  })

  it('数値も文字列化して埋める', () => {
    expect(expandTemplate('最大${max}件', { max: 100 })).toBe('最大100件')
  })

  it('null / undefined は空文字にする', () => {
    expect(expandTemplate('[${a}][${b}]', { a: null, b: undefined })).toBe('[][]')
  })

  it('values に無いキーはそのまま残す', () => {
    expect(expandTemplate('${target} を削除しました。', { other: 'x' })).toBe('${target} を削除しました。')
  })

  it('継承プロパティのキーは置換しない', () => {
    expect(expandTemplate('${toString}', {})).toBe('${toString}')
    expect(expandTemplate('${constructor}', {})).toBe('${constructor}')
  })

  it('JS の式としては評価しない', () => {
    expect(expandTemplate('${1 + 1}', { a: 1 })).toBe('${1 + 1}')
    expect(expandTemplate('${process.env.DATABASE_URL}', {})).toBe('${process.env.DATABASE_URL}')
  })
})

const config: LocaleConfig = {
  locales: ['ja', 'en'],
  resources: { ja: {}, en: {} },
  fallbackLocale: 'en',
  cookie: { name: 'locale', maxAge: 60 },
}

describe('pickLocale', () => {
  it('Cookie の指定を Accept-Language より優先する', () => {
    expect(pickLocale(config, 'en', 'en-US,en;q=0.9', 'ja')).toBe('ja')
  })

  it('未対応ロケールの Cookie は無視する', () => {
    expect(pickLocale(config, 'en', 'ja', 'fr')).toBe('ja')
  })

  it('Accept-Language から対応ロケールを選ぶ(地域サブタグは無視)', () => {
    expect(pickLocale(config, 'en', 'ja-JP,ja;q=0.9', null)).toBe('ja')
    expect(pickLocale(config, 'ja', 'en-GB', null)).toBe('en')
  })

  it('Accept-Language の後順位に対応ロケールがあればそれを選ぶ', () => {
    expect(pickLocale(config, 'en', 'fr-FR,fr;q=0.9,ja;q=0.5', null)).toBe('ja')
  })

  it('どれにも一致しなければ fallbackLocale にする', () => {
    expect(pickLocale(config, 'en', 'fr-FR,fr;q=0.9', null)).toBe('en')
    expect(pickLocale(config, 'ja', 'fr', null)).toBe('ja')
  })

  it('Accept-Language が無ければ fallbackLocale にする', () => {
    expect(pickLocale(config, 'en', null, null)).toBe('en')
  })
})

describe('pickFallbackLocale', () => {
  it('DEFAULT_LOCALE が無ければ設定の fallbackLocale にする', () => {
    expect(pickFallbackLocale(config, undefined)).toBe('en')
    expect(pickFallbackLocale(config, '')).toBe('en')
  })

  it('DEFAULT_LOCALE を明示すればそれを優先する', () => {
    expect(pickFallbackLocale(config, 'ja')).toBe('ja')
  })
})
