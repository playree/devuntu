/** 改名した環境変数の旧名に対する起動時の警告 */

import { warnDeprecatedEnv } from '@/lib/env-deprecated'
import { afterEach, describe, expect, it, vi } from 'vitest'

const warn = vi.hoisted(() => vi.fn())
vi.mock('@/lib/logger', () => ({ logger: { warn } }))

afterEach(() => {
  vi.unstubAllEnvs()
  warn.mockClear()
})

describe('warnDeprecatedEnv', () => {
  it('旧名 DISABLE_PASSWORD_AUTH が設定されていれば新名を添えて警告する', () => {
    vi.stubEnv('DISABLE_PASSWORD_AUTH', 'true')
    warnDeprecatedEnv()
    expect(warn).toHaveBeenCalledWith(
      { deprecated: 'DISABLE_PASSWORD_AUTH', replacement: 'PASSWORDLESS_AUTH_ENABLED' },
      expect.any(String),
    )
  })

  it('旧名が無ければ警告しない', () => {
    vi.stubEnv('DISABLE_PASSWORD_AUTH', '')
    vi.stubEnv('PASSWORDLESS_AUTH_ENABLED', 'true')
    warnDeprecatedEnv()
    expect(warn).not.toHaveBeenCalled()
  })
})
