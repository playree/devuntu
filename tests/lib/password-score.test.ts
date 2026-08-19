/**
 * `@zxcvbn-ts/core` は辞書オプションを渡さないと頻出パスワードでも score 4 を返すため、
 * 辞書が実際に効いていることを検証する
 */

import { getPasswordScore } from '@/lib/password-score'
import { describe, expect, it } from 'vitest'

describe('getPasswordScore', () => {
  it('空文字は 0', async () => {
    await expect(getPasswordScore('')).resolves.toBe(0)
  })

  it.each(['password123', 'qwerty', 'qwertyuiop', 'letmein', 'p@ssw0rd', '12345678', 'aaaaaaaa'])(
    '頻出パスワード・キーボード列・繰り返しは 1 以下: %s',
    async (password) => {
      expect(await getPasswordScore(password)).toBeLessThanOrEqual(1)
    },
  )

  it.each(['correcthorsebatterystaple', '7Kq-vZm2Tb!xR9wd'])('十分に強いパスワードは 4: %s', async (password) => {
    expect(await getPasswordScore(password)).toBe(4)
  })

  it('辞書語 + 数字は中間のスコアになる', async () => {
    const score = await getPasswordScore('Sakura2024')
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(4)
  })
})
