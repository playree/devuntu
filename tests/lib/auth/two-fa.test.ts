/** 2FA 未設定のセッションを止める条件。Proxy・Server Action・API・OAuth の認可が同じ判定を使う */

import { requiresTwoFaSetup } from '@/lib/auth/two-fa'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ TWO_FA_REQUIRED: true, DISABLE_PASSWORD_AUTH: false }))
vi.mock('@/lib/env-util', () => ({ envu: { server: env } }))

beforeEach(() => {
  env.TWO_FA_REQUIRED = true
  env.DISABLE_PASSWORD_AUTH = false
})

describe('requiresTwoFaSetup', () => {
  it('2FA 必須でパスワード認証が有効なら、未設定の利用者を止める', () => {
    expect(requiresTwoFaSetup({ twoFactorEnabled: false })).toBe(true)
    expect(requiresTwoFaSetup({ twoFactorEnabled: null })).toBe(true)
    expect(requiresTwoFaSetup({})).toBe(true)
  })

  it('2FA を設定済みなら止めない', () => {
    expect(requiresTwoFaSetup({ twoFactorEnabled: true })).toBe(false)
  })

  it('2FA 必須でない運用では止めない', () => {
    env.TWO_FA_REQUIRED = false
    expect(requiresTwoFaSetup({ twoFactorEnabled: false })).toBe(false)
  })

  it('パスワード認証を無効にした運用では止めない(OTP サインイン自体がメールの確認を兼ねる)', () => {
    env.DISABLE_PASSWORD_AUTH = true
    expect(requiresTwoFaSetup({ twoFactorEnabled: false })).toBe(false)
  })
})
