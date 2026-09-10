/**
 * ID token に載せる OIDC 標準クレームの単体テスト
 *
 * `@better-auth/oauth-provider` のバージョンアップで ID token から標準クレームが
 * 落ちると SSO 先(NetBird など)が認証できなくなるため、scope との対応を固定する。
 */

import { idTokenStandardClaims, toPublicAvatarUrl } from '@/lib/oauth/oidc-claims'
import { toUploadUrl } from '@/lib/storage/upload'
import { describe, expect, it } from 'vitest'

const key = '019eef64-6cc1-78f1-8f50-1ef86986289a.webp'
/** vitest.setup.ts の BETTER_AUTH_URL を基準にした、未認証で読めるアバターの絶対URL */
const publicAvatar = `http://localhost:3000/api/avatar/${key}`

const user = {
  name: 'Test User',
  email: 'test@example.com',
  emailVerified: true,
  image: toUploadUrl(key),
}

describe('idTokenStandardClaims', () => {
  it('profile と email の scope で標準クレームが揃う', () => {
    expect(idTokenStandardClaims(user, ['openid', 'profile', 'email'])).toEqual({
      name: 'Test User',
      picture: publicAvatar,
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
      picture: publicAvatar,
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

  it('外部URLのまま残っているアバターはそのまま渡す', () => {
    const external = 'https://idp.example.com/avatar.webp'
    expect(idTokenStandardClaims({ ...user, image: external }, ['profile'])).toMatchObject({ picture: external })
  })

  it('emailVerified が false ならそのまま false を返す', () => {
    expect(idTokenStandardClaims({ ...user, emailVerified: false }, ['email'])).toEqual({
      email: 'test@example.com',
      email_verified: false,
    })
  })
})

describe('toPublicAvatarUrl', () => {
  it('管理下のアバターは未認証で読める絶対URLにする', () => {
    // 相対パスのままでは連携先が解決できず、`/api/upload` は配信にログインが要る
    expect(toPublicAvatarUrl(toUploadUrl(key))).toBe(publicAvatar)
  })

  it('管理外のURLは変換しない', () => {
    expect(toPublicAvatarUrl('https://idp.example.com/avatar.webp')).toBe('https://idp.example.com/avatar.webp')
  })
})
