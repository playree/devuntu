/**
 * proxy のパス判定(認証 / 管理者ゲート)の単体テスト
 *
 * パターンの書き間違いはゲートの素通りに直結するため、代表的なパスで固定する。
 */

import { authConfig } from '@/lib/auth-config'
import { matchCondition } from '@/lib/match'
import { describe, expect, it } from 'vitest'

const isAdminGuarded = (path: string) => matchCondition(path, authConfig.target.admin)
const needsAuth = (path: string) => matchCondition(path, authConfig.target.auth)

describe('管理者ゲート: /admin 配下はネストしていても対象にする', () => {
  it.each(['/admin', '/admin/users', '/admin/users/01920000-0000-7000-8000-000000000001', '/admin/settings/oidc'])(
    '%s は管理者のみ',
    (path) => {
      expect(isAdminGuarded(path)).toBe(true)
    },
  )

  it.each(['/administrator', '/adminx', '/boards', '/tickets/1'])('%s は管理者ゲートの対象外', (path) => {
    expect(isAdminGuarded(path)).toBe(false)
  })
})

describe('認証ゲート: 公開ページだけ除外する', () => {
  it.each(['/', '/boards', '/cal', '/admin/users'])('%s は認証が必要', (path) => {
    expect(needsAuth(path)).toBe(true)
  })

  it.each(['/auth/signin', '/start', '/cal/abcdef123456'])('%s は認証不要', (path) => {
    expect(needsAuth(path)).toBe(false)
  })
})
