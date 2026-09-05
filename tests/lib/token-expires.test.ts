/**
 * 長期トークンの有効期限。
 *
 * エージェントのトークンとユーザーの MCP トークンで共有する変換なので、
 * 選択肢の値がそのまま日数として効くことを固定する。
 */

import { TOKEN_EXPIRES, tokenExpiresAt } from '@/lib/token-expires'
import { describe, expect, it } from 'vitest'

describe('tokenExpiresAt', () => {
  const from = new Date('2026-01-01T00:00:00.000Z')

  it('none は無期限(null)', () => {
    expect(tokenExpiresAt('none', from)).toBeNull()
  })

  it('日数ぶん先の日時を返す', () => {
    expect(tokenExpiresAt('30', from)?.toISOString()).toBe('2026-01-31T00:00:00.000Z')
    expect(tokenExpiresAt('365', from)?.toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })

  it('none 以外の選択肢はすべて日数として解釈できる', () => {
    for (const value of TOKEN_EXPIRES.filter((v) => v !== 'none')) {
      expect(Number.isNaN(Number(value))).toBe(false)
      expect(tokenExpiresAt(value, from)).toBeInstanceOf(Date)
    }
  })
})
