/**
 * OAuth の認可要求に課すセッションの鮮度の単体テスト
 *
 * `offline_access` のリフレッシュトークンを、古いセッション(奪われた Cookie)から発行させないための判定。
 */

import {
  freshMaxAge,
  isAuthorizeRequestBody,
  requiresFreshAuthorization,
  withFreshMaxAge,
} from '@/lib/oauth/oauth-authorize'
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

describe('withFreshMaxAge', () => {
  it('offline_access を求める要求に max_age を設定し、ほかのパラメータは保つ', () => {
    expect(withFreshMaxAge({ client_id: 'c', scope: 'openid offline_access' }, 86400)).toEqual({
      client_id: 'c',
      scope: 'openid offline_access',
      max_age: '86400',
    })
  })

  it('より厳しい max_age はそのまま残す', () => {
    expect(withFreshMaxAge({ scope: 'offline_access', max_age: '60' }, 86400)).toEqual({
      scope: 'offline_access',
      max_age: '60',
    })
  })

  it('offline_access を求めない要求には手を加えない', () => {
    expect(withFreshMaxAge({ scope: 'openid profile email' }, 86400)).toBeUndefined()
  })

  it('freshAge が 0 なら手を加えない', () => {
    expect(withFreshMaxAge({ scope: 'offline_access' }, 0)).toBeUndefined()
  })

  it.each([undefined, null, 'scope=offline_access'])('パラメータがオブジェクトでなければ手を加えない: %s', (params) => {
    expect(withFreshMaxAge(params, 86400)).toBeUndefined()
  })
})

describe('isAuthorizeRequestBody', () => {
  it('response_type を持つ body は認可要求', () => {
    expect(isAuthorizeRequestBody({ response_type: 'code', client_id: 'c' })).toBe(true)
  })

  it.each([{ accept: true, oauth_query: 'a=b' }, undefined, null, 'response_type=code'])(
    '同意画面の送信内容などは認可要求ではない: %s',
    (body) => {
      expect(isAuthorizeRequestBody(body)).toBe(false)
    },
  )
})
