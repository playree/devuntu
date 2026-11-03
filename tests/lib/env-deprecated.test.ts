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
  it('旧名だけが設定されていれば、旧名の値が効いている旨を新名を添えて警告する', () => {
    vi.stubEnv('PASSWORDLESS_AUTH_ENABLED', '')
    vi.stubEnv('DISABLE_PASSWORD_AUTH', 'true')
    warnDeprecatedEnv()
    expect(warn).toHaveBeenCalledWith(
      { deprecated: 'DISABLE_PASSWORD_AUTH', replacement: 'PASSWORDLESS_AUTH_ENABLED', passwordless: true },
      expect.stringContaining('in effect'),
    )
  })

  it('新旧両方あれば、旧名は効いていない旨を警告する', () => {
    vi.stubEnv('PASSWORDLESS_AUTH_ENABLED', 'false')
    vi.stubEnv('DISABLE_PASSWORD_AUTH', 'true')
    warnDeprecatedEnv()
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ passwordless: false }),
      expect.stringContaining('ignored'),
    )
  })

  it('旧名が無ければ警告しない', () => {
    vi.stubEnv('DISABLE_PASSWORD_AUTH', '')
    vi.stubEnv('PASSWORDLESS_AUTH_ENABLED', 'true')
    warnDeprecatedEnv()
    expect(warn).not.toHaveBeenCalled()
  })
})
