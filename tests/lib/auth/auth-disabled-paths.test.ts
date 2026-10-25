/**
 * better-auth 標準のエンドポイントのうち、塞いでいるもの。
 *
 * `/update-user` はセッションだけで `user.image` を任意の値にでき、公開アバターの配信判定や
 * アバター削除の対象を他人の添付へ向けられてしまう。
 *
 * パスワード認証が有効な運用では、メール OTP のサインインとパスワード再設定が
 * パスワード + 2FA をメールボックスだけで迂回する経路になる。
 */

import { emailOTP } from 'better-auth/plugins'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

type Auth = (typeof import('@/lib/auth/auth'))['auth']

const loadAuth = async (disablePasswordAuth: boolean): Promise<Auth> => {
  vi.stubEnv('DISABLE_PASSWORD_AUTH', String(disablePasswordAuth))
  vi.resetModules()
  return (await import('@/lib/auth/auth')).auth
}

const post = async (auth: Auth, path: string, body: object) =>
  auth.handler(
    new Request(new URL(`/api/auth${path}`, process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

const otpBody = { email: 'user@example.com', otp: '000000', password: 'password1234' }

// 名前が変わって 404 になっただけのものを「塞いだ」と取り違えないよう、プラグインの定義から列挙する
const emailOtpPaths = Object.values(emailOTP({ sendVerificationOTP: async () => {} }).endpoints).flatMap((endpoint) =>
  endpoint.path ? [endpoint.path] : [],
)

afterAll(() => {
  vi.unstubAllEnvs()
})

describe('塞いだエンドポイント', () => {
  it('メール OTP のサインインとパスワード再設定がプラグインの定義に含まれる', () => {
    expect(emailOtpPaths).toEqual(
      expect.arrayContaining(['/sign-in/email-otp', '/email-otp/request-password-reset', '/email-otp/reset-password']),
    )
  })

  describe('パスワード認証が有効', () => {
    let auth: Auth
    beforeAll(async () => {
      auth = await loadAuth(false)
    })

    it('/update-user は 404 を返す', async () => {
      const res = await post(auth, '/update-user', { image: '/api/upload/00000000-0000-7000-8000-000000000000.webp' })
      expect(res.status).toBe(404)
    })

    it.each(emailOtpPaths)('%s は 404 を返す', async (path) => {
      const res = await post(auth, path, otpBody)
      expect(res.status).toBe(404)
    })

    it('2FA の OTP の経路は塞がない', async () => {
      const res = await post(auth, '/two-factor/send-otp', {})
      expect(res.status).not.toBe(404)
    })
  })

  describe('パスワード認証が無効', () => {
    let auth: Auth
    beforeAll(async () => {
      auth = await loadAuth(true)
    })

    it.each(emailOtpPaths)('%s は塞がない', async (path) => {
      const res = await post(auth, path, otpBody)
      expect(res.status).not.toBe(404)
    })
  })
})
