/** パターンの書き間違いはゲートの素通りに直結するため、代表的なパスで固定する */

import { authConfig, isProxyAuthBypassPath } from '@/lib/auth/auth-config'
import { MAINTENANCE_MODE_TARGET } from '@/lib/maintenance/maintenance-mode'
import { matchCondition } from '@/lib/match'
import { describe, expect, it } from 'vitest'

const isAdminGuarded = (path: string) => matchCondition(path, authConfig.target.admin)
const needsAuth = (path: string) => matchCondition(path, authConfig.target.auth)
const isBlockedByMaintenance = (path: string) => matchCondition(path, MAINTENANCE_MODE_TARGET)

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

  it.each(['/auth/signin', '/start', '/cal/abcdef123456', '/maintenance'])('%s は認証不要', (path) => {
    expect(needsAuth(path)).toBe(false)
  })
})

describe('認証バイパス: 画面ではないパスは Proxy の認証処理を通さない', () => {
  it.each([
    '/api/mcp',
    '/api/health',
    // 拡張子を持つルートハンドラ。matcher ではなくここで拾う
    '/api/upload/019fab7b-3d5c-74bd-b45f-1c88cb683a57.webp',
    '/api/avatar/019fab7b-3d5c-74bd-b45f-1c88cb683a57.webp',
    // 末尾に拡張子が無いため、プレフィックスで拾う必要がある
    '/.well-known/oauth-authorization-server/api/auth',
    '/.well-known/oauth-protected-resource/api/mcp',
    '/sw.js',
    '/robots.txt',
    '/manifest.webmanifest',
    '/favicon.ico',
    '/agent/devuntu_agent.py',
  ])('%s は認証処理を通さない', (path) => {
    expect(isProxyAuthBypassPath(path)).toBe(true)
  })

  it.each(['/', '/boards', '/boards/019fab7b-3d5c-74bd-b45f-1c88cb683a57', '/admin/users', '/maintenance'])(
    '%s は画面なので認証処理を通す',
    (path) => {
      expect(isProxyAuthBypassPath(path)).toBe(false)
    },
  )
})

describe('メンテナンスモード: 監視とメンテナンス画面のアセット以外を遮断する', () => {
  it.each([
    '/',
    '/boards',
    '/auth/signin',
    '/api/mcp',
    '/api/upload/019fab7b-3d5c-74bd-b45f-1c88cb683a57.webp',
    '/api/avatar/019fab7b-3d5c-74bd-b45f-1c88cb683a57.webp',
    '/.well-known/oauth-authorization-server/api/auth',
  ])('%s は遮断する', (path) => {
    expect(isBlockedByMaintenance(path)).toBe(true)
  })

  it.each(['/api/health', '/favicon.ico'])('%s は遮断しない', (path) => {
    expect(isBlockedByMaintenance(path)).toBe(false)
  })
})
