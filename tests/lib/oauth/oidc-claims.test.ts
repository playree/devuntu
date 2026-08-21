/**
 * ID token に載せる OIDC 標準クレームの単体テスト
 *
 * `@better-auth/oauth-provider` のバージョンアップで ID token から標準クレームが
 * 落ちると SSO 先(NetBird など)が認証できなくなるため、scope との対応を固定する。
 */

import { idTokenStandardClaims } from '@/lib/oauth/oidc-claims'
import { describe, expect, it } from 'vitest'

const user = {
  name: 'Test User',
  email: 'test@example.com',
  emailVerified: true,
  image: 'https://example.com/avatar.webp',
}

describe('idTokenStandardClaims', () => {
  it('profile と email の scope で標準クレームが揃う', () => {
    expect(idTokenStandardClaims(user, ['openid', 'profile', 'email'])).toEqual({
      name: 'Test User',
      picture: 'https://example.com/avatar.webp',
      given_name: 'Test',
      family_name: 'User',
      email: 'test@example.com',
      email_verified: true,
    })
  })

  it('openid だけなら標準クレームを付けない', () => {
    expect(idTokenStandardClaims(user, ['openid'])).toEqual({})
  })

  it('email scope だけならメール関連のみ', () => {
    expect(idTokenStandardClaims(user, ['openid', 'email'])).toEqual({
      email: 'test@example.com',
      email_verified: true,
    })
  })

  it('profile scope だけならプロフィール関連のみ', () => {
    expect(idTokenStandardClaims(user, ['openid', 'profile'])).toEqual({
      name: 'Test User',
      picture: 'https://example.com/avatar.webp',
      given_name: 'Test',
      family_name: 'User',
    })
  })

  it('画像未設定・単語ひとつの表示名では余計なキーを作らない', () => {
    const claims = idTokenStandardClaims({ ...user, name: 'devuntu', image: null }, ['openid', 'profile'])
    expect(claims).toEqual({ name: 'devuntu' })
    expect('picture' in claims).toBe(false)
    expect('given_name' in claims).toBe(false)
  })

  it('emailVerified が false ならそのまま false を返す', () => {
    expect(idTokenStandardClaims({ ...user, emailVerified: false }, ['email'])).toEqual({
      email: 'test@example.com',
      email_verified: false,
    })
  })
})
