import { SESSION_NOT_FRESH } from '@/lib/auth/auth-config'
import { assertFreshSession } from '@/lib/auth/session-fresh'
import { ClientError } from '@/lib/error'
import { afterEach, describe, expect, it, vi } from 'vitest'

const FRESH_AGE = 60 * 60 * 24

const setFreshAge = (value: number) => {
  vi.stubEnv('SESSION_FRESH_AGE', String(value))
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('assertFreshSession', () => {
  it('ログイン直後は通る', () => {
    setFreshAge(FRESH_AGE)
    expect(() => assertFreshSession({ createdAt: new Date() })).not.toThrow()
  })

  it('SESSION_FRESH_AGE を超えたら SESSION_NOT_FRESH を投げる', () => {
    setFreshAge(FRESH_AGE)
    const createdAt = new Date(Date.now() - FRESH_AGE * 1000)

    try {
      assertFreshSession({ createdAt })
      expect.unreachable('鮮度が切れたら throw する')
    } catch (e) {
      expect(e).toBeInstanceOf(ClientError)
      expect((e as ClientError).errorType).toBe(SESSION_NOT_FRESH)
    }
  })

  it('SESSION_FRESH_AGE が 0 ならチェックしない', () => {
    setFreshAge(0)
    const createdAt = new Date(Date.now() - FRESH_AGE * 1000 * 365)
    expect(() => assertFreshSession({ createdAt })).not.toThrow()
  })
})
