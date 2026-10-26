/**
 * OAuth の認可要求に課すセッションの鮮度の単体テスト
 *
 * `offline_access` のリフレッシュトークンを、古いセッション(奪われた Cookie)から発行させないための判定。
 */

import { freshMaxAge, requiresFreshAuthorization } from '@/lib/oauth/oauth-authorize'
import { describe, expect, it } from 'vitest'

describe('requiresFreshAuthorization', () => {
  it.each(['openid offline_access mcp', 'offline_access', 'mcp offline_access'])(
    'offline_access を含む要求は対象: %s',
    (scope) => {
      expect(requiresFreshAuthorization(scope)).toBe(true)
    },
  )

  it.each(['openid profile email', 'openid', 'mcp', 'offline_accessx', ''])(
    'offline_access を含まない要求は対象外: %s',
    (scope) => {
      expect(requiresFreshAuthorization(scope)).toBe(false)
    },
  )

  it('scope 未指定はクライアントの既定スコープになるので対象に倒す', () => {
    expect(requiresFreshAuthorization(undefined)).toBe(true)
  })
})

describe('freshMaxAge', () => {
  it('freshAge が 0 ならチェック無効として差し込まない', () => {
    expect(freshMaxAge(undefined, 0)).toBeUndefined()
    expect(freshMaxAge('60', 0)).toBeUndefined()
  })

  it('max_age 未指定なら freshAge を使う', () => {
    expect(freshMaxAge(undefined, 86400)).toBe(86400)
  })

  it.each([
    ['60', 60],
    ['0', 0],
    ['86400', 86400],
    [60, 60],
  ])('freshAge 以下の max_age は尊重する: %s', (requested, expected) => {
    expect(freshMaxAge(requested, 86400)).toBe(expected)
  })

  it.each(['86401', '999999999', 86401])('freshAge より緩い max_age は上書きする: %s', (requested) => {
    expect(freshMaxAge(requested, 86400)).toBe(86400)
  })

  it.each(['', ' ', 'abc', '-1', '1.5', '1e3x', null, {}])('読めない max_age は freshAge にする: %s', (requested) => {
    expect(freshMaxAge(requested, 86400)).toBe(86400)
  })
})
