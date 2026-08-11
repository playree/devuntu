/**
 * レートリミッタの単体テスト
 *
 * 固定ウィンドウのカウンタなので、境界(limit ちょうど / 超過 / ウィンドウ明け)を確認する。
 * カウンタはモジュールスコープで共有されるため、テストごとに別のキーを使う。
 */

import { ClientError, TOO_MANY_REQUESTS } from '@/lib/error'
import { assertRateLimit, consumeRateLimit } from '@/lib/rate-limit'
import { afterEach, describe, expect, it, vi } from 'vitest'

const RULE = { limit: 3, windowMs: 1000 }

afterEach(() => {
  vi.useRealTimers()
})

describe('consumeRateLimit: 固定ウィンドウのカウンタ', () => {
  it('limit 回までは true、超えたら false', () => {
    const key = 'test:within'
    expect([1, 2, 3].map(() => consumeRateLimit(key, RULE))).toEqual([true, true, true])
    expect(consumeRateLimit(key, RULE), '4 回目').toBe(false)
    expect(consumeRateLimit(key, RULE), '超過後も false のまま').toBe(false)
  })

  it('キーが違えばカウンタは独立する', () => {
    expect([1, 2, 3].map(() => consumeRateLimit('test:a', RULE))).toEqual([true, true, true])
    expect(consumeRateLimit('test:b', RULE), '別キーは影響を受けない').toBe(true)
  })

  it('ウィンドウが明けるとカウンタが戻る', () => {
    vi.useFakeTimers()
    const key = 'test:window'
    expect([1, 2, 3].map(() => consumeRateLimit(key, RULE))).toEqual([true, true, true])
    expect(consumeRateLimit(key, RULE)).toBe(false)

    vi.advanceTimersByTime(RULE.windowMs + 1)
    expect(consumeRateLimit(key, RULE), 'ウィンドウ明けは再び通る').toBe(true)
  })
})

describe('assertRateLimit: 超過時は ClientError', () => {
  it('制限内は何も起きず、超過で TOO_MANY_REQUESTS を投げる', () => {
    const key = 'test:assert'
    expect(() => [1, 2, 3].forEach(() => assertRateLimit(key, RULE))).not.toThrow()

    try {
      assertRateLimit(key, RULE)
      expect.unreachable('制限を超えたら throw する')
    } catch (e) {
      expect(e).toBeInstanceOf(ClientError)
      expect((e as ClientError).errorType).toBe(TOO_MANY_REQUESTS)
    }
  })
})
