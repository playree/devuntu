/**
 * 運用ツールの表示言語の切り替えと、ja / en のメッセージ定義の対応の単体テスト
 *
 * 片方の言語にだけキーがあると、その言語でだけキー名がそのまま表示される。
 * 関数メッセージの引数の数がずれると、埋め込むはずの値が抜ける。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createT, currentLocale, resolveLocale, setLocale } from '../../scripts/i18n.mjs'
import { messages as toolMessages } from '../../scripts/messages.mjs'
import { messages as setupEnvMessages } from '../../scripts/setup-env/messages.mjs'

describe('resolveLocale', () => {
  it('ja のときだけ日本語', () => {
    expect(resolveLocale('ja')).toBe('ja')
  })

  it('それ以外(未設定を含む)は英語', () => {
    for (const value of ['en', 'en-US', 'JA', 'fr', '', undefined]) {
      expect(resolveLocale(value)).toBe('en')
    }
  })
})

describe('createT', () => {
  const t = createT({
    ja: { hello: 'こんにちは', greet: (name: string) => `${name}さん` },
    en: { hello: 'Hello', greet: (name: string) => `Hi ${name}` },
  })
  let saved: string | undefined

  beforeEach(() => {
    saved = process.env.DEFAULT_LOCALE
  })

  afterEach(() => {
    setLocale(undefined)
    if (saved === undefined) {
      delete process.env.DEFAULT_LOCALE
    } else {
      process.env.DEFAULT_LOCALE = saved
    }
  })

  it('呼び出した時点の DEFAULT_LOCALE で決める', () => {
    process.env.DEFAULT_LOCALE = 'ja'
    expect(t('hello')).toBe('こんにちは')
    process.env.DEFAULT_LOCALE = 'en'
    expect(t('hello')).toBe('Hello')
    delete process.env.DEFAULT_LOCALE
    expect(t('hello')).toBe('Hello')
  })

  it('関数メッセージへ引数を渡す', () => {
    process.env.DEFAULT_LOCALE = 'ja'
    expect(t('greet', 'A')).toBe('Aさん')
  })

  it('setLocale は環境変数より優先し、undefined で解除する', () => {
    process.env.DEFAULT_LOCALE = 'en'
    setLocale('ja')
    expect(currentLocale()).toBe('ja')
    expect(t('hello')).toBe('こんにちは')
    setLocale(undefined)
    expect(currentLocale()).toBe('en')
  })

  it('定義の無いキーはキー名を返す', () => {
    expect(t('missing')).toBe('missing')
  })
})

describe.each([
  ['messages.mjs', toolMessages],
  ['setup-env/messages.mjs', setupEnvMessages],
])('%s', (_, { ja, en }: { ja: Record<string, unknown>; en: Record<string, unknown> }) => {
  it('ja と en のキーが一致する', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ja).sort())
  })

  it('値の形(文字列 / 配列 / 関数と引数の数)が一致する', () => {
    const shape = (value: unknown) =>
      typeof value === 'function' ? `function/${value.length}` : Array.isArray(value) ? 'array' : typeof value
    for (const key of Object.keys(ja)) {
      expect(shape(en[key]), key).toBe(shape(ja[key]))
    }
  })
})
