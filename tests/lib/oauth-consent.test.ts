/**
 * 同意画面(/consent)がプラグインへ渡す署名付きクエリの組み立ての単体テスト
 *
 * oauth-provider の署名検証は「渡したクエリ全体」で HMAC を再計算するため、
 * 署名対象(`ba_param`)以外が混ざると invalid_signature になり同意が完了しなくなる。
 * その絞り込みと、重複・順序の保持を固定する。
 */

import { MCP_SCOPES } from '@/lib/auth'
import {
  buildSignedOAuthQuery,
  consentScopeLocaleItem,
  parseConsentScopes,
  parseRequestedUserInfoClaims,
} from '@/lib/oauth-consent'
import { describe, expect, it } from 'vitest'

const signedQuery = [
  'client_id=abc',
  'redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb',
  'response_type=code',
  'scope=openid+profile+email',
  'state=xyz',
  'exp=1700000600',
  'ba_iat=1700000000000',
  'ba_param=ba_iat',
  'ba_param=ba_param',
  'ba_param=client_id',
  'ba_param=exp',
  'ba_param=redirect_uri',
  'ba_param=response_type',
  'ba_param=scope',
  'ba_param=state',
  'sig=dummy-signature',
].join('&')

describe('buildSignedOAuthQuery', () => {
  it('署名付きクエリをそのまま復元する', () => {
    expect(buildSignedOAuthQuery(`?${signedQuery}`)).toBe(signedQuery)
  })

  it('sig が無ければ undefined', () => {
    expect(buildSignedOAuthQuery('?client_id=abc&ba_param=client_id')).toBeUndefined()
  })

  it('ba_param が無ければ undefined', () => {
    expect(buildSignedOAuthQuery('?client_id=abc&sig=dummy-signature')).toBeUndefined()
  })

  it('署名対象外のパラメータを落とす', () => {
    // 検証は sig を除く全パラメータで再計算されるので、混入を残すと必ず失敗する
    const result = buildSignedOAuthQuery(`?${signedQuery}&utm_source=mail`)
    expect(result).toBe(signedQuery)
  })

  it('重複するパラメータを保持する', () => {
    const query = [
      'client_id=abc',
      'resource=https%3A%2F%2Fapi.example.com',
      'resource=https%3A%2F%2Fapi2.example.com',
      'ba_param=ba_param',
      'ba_param=client_id',
      'ba_param=resource',
      'sig=dummy-signature',
    ].join('&')
    expect(buildSignedOAuthQuery(`?${query}`)).toBe(query)
  })
})

describe('consentScopeLocaleItem', () => {
  it('提供している全スコープに説明がある', () => {
    for (const scope of MCP_SCOPES) {
      expect(consentScopeLocaleItem(scope)).toBeDefined()
    }
  })

  it('未知のスコープは undefined', () => {
    expect(consentScopeLocaleItem('unknown_scope')).toBeUndefined()
  })
})

describe('parseConsentScopes', () => {
  it.each([
    ['openid profile email', ['openid', 'profile', 'email']],
    ['openid  profile', ['openid', 'profile']],
    ['openid openid profile', ['openid', 'profile']],
    ['', []],
    [undefined, []],
  ])('%s を分解する', (scope, expected) => {
    expect(parseConsentScopes(scope)).toEqual(expected)
  })
})

describe('parseRequestedUserInfoClaims', () => {
  it('userinfo のクレーム名を取り出す', () => {
    const claims = JSON.stringify({ userinfo: { email: null, groups: { essential: true } }, id_token: { sub: null } })
    expect(parseRequestedUserInfoClaims(claims)).toEqual(['email', 'groups'])
  })

  it.each([undefined, '', 'not-json', '[]', '{"userinfo":"x"}'])('壊れた値(%s)でも落ちない', (claims) => {
    expect(parseRequestedUserInfoClaims(claims)).toEqual([])
  })
})
