/**
 * `@zxcvbn-ts/core` は辞書オプションを渡さないと頻出パスワードでも score 4 を返すため、
 * 辞書が実際に効いていることを検証する
 */

import { getPasswordScore } from '@/lib/password-score'
import { describe, expect, it, vi } from 'vitest'

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

  it('辞書の読み込みに失敗したら 0 を返し、次の呼び出しで読み直す', async () => {
    vi.resetModules()
    let attempt = 0
    vi.doMock('@zxcvbn-ts/language-common', async (importOriginal) => {
      const original = await importOriginal<typeof import('@zxcvbn-ts/language-common')>()
      return {
        ...original,
        get dictionary() {
          attempt += 1
          if (attempt === 1) {
            throw new Error('failed to load dictionary')
          }
          return original.dictionary
        },
      }
    })
    // 失敗は console.error に出るのでテスト出力を汚さないよう抑える
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const { getPasswordScore: get } = await import('@/lib/password-score')
      expect(await get('7Kq-vZm2Tb!xR9wd')).toBe(0)
      expect(errorSpy).toHaveBeenCalled()
      // 失敗した Promise がキャッシュされていれば、ここも 0 のままになる
      expect(await get('7Kq-vZm2Tb!xR9wd')).toBe(4)
    } finally {
      errorSpy.mockRestore()
      vi.doUnmock('@zxcvbn-ts/language-common')
      vi.resetModules()
    }
  })
})
