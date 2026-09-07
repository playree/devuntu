/** カウンタはモジュールスコープで共有されるため、テストごとに別のキーを使う */

import { ClientError, TOO_MANY_REQUESTS } from '@/lib/error'
import { assertRateLimit, consumeRateLimit, MAX_ENTRIES, remainingRateLimit } from '@/lib/rate-limit'
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

describe('consumeRateLimit: まとめて消費する', () => {
  it('count 回ぶん消費し、枠を超えたら false', () => {
    const key = 'test:count'
    expect(consumeRateLimit(key, RULE, 2), '2 回ぶん').toBe(true)
    expect(consumeRateLimit(key, RULE, 2), '合計 4 回で超過').toBe(false)
  })

  it('最初の呼び出しで枠を超える件数を渡した場合も false', () => {
    expect(consumeRateLimit('test:count-over', RULE, RULE.limit + 1)).toBe(false)
  })

  it('count を省略すると 1 回ぶん', () => {
    const key = 'test:count-default'
    consumeRateLimit(key, RULE, 2)
    expect(consumeRateLimit(key, RULE), '3 回目までは通る').toBe(true)
    expect(consumeRateLimit(key, RULE)).toBe(false)
  })
})

describe('remainingRateLimit: 残枠を消費せずに見る', () => {
  it('未使用のキーは limit がそのまま残枠', () => {
    expect(remainingRateLimit('test:remaining-fresh', RULE)).toBe(RULE.limit)
  })

  it('消費した分だけ減り、見るだけでは減らない', () => {
    const key = 'test:remaining'
    consumeRateLimit(key, RULE, 2)
    expect(remainingRateLimit(key, RULE)).toBe(1)
    expect(remainingRateLimit(key, RULE), '見るだけなら変わらない').toBe(1)
  })

  it('超過していても負にはならない', () => {
    const key = 'test:remaining-over'
    consumeRateLimit(key, RULE, RULE.limit + 5)
    expect(remainingRateLimit(key, RULE)).toBe(0)
  })

  it('ウィンドウが明けると残枠が戻る', () => {
    vi.useFakeTimers()
    const key = 'test:remaining-window'
    consumeRateLimit(key, RULE, RULE.limit)
    expect(remainingRateLimit(key, RULE)).toBe(0)

    vi.advanceTimersByTime(RULE.windowMs + 1)
    expect(remainingRateLimit(key, RULE)).toBe(RULE.limit)
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

// カウンタを上限まで積んで他のテストのキーを巻き込むので、最後に置く
describe('consumeRateLimit: 上限到達時の追い出し', () => {
  /** ウィンドウ明けと追い出しを混同しないよう、この describe では時間を止めて長い窓だけを使う */
  const LONG = { limit: 3, windowMs: 60_000 }

  it('制限内の古いキーから捨てられ、超過中のキーは残る', () => {
    vi.useFakeTimers()

    const blocked = 'evict:blocked'
    expect([1, 2, 3].map(() => consumeRateLimit(blocked, LONG))).toEqual([true, true, true])
    expect(consumeRateLimit(blocked, LONG), '追い出し前から超過している').toBe(false)

    const spare = 'evict:spare'
    expect(consumeRateLimit(spare, LONG), '制限内のカウンタ').toBe(true)

    for (let i = 0; i < MAX_ENTRIES; i++) {
      consumeRateLimit(`evict:fill:${i}`, LONG)
    }

    expect(consumeRateLimit(blocked, LONG), '超過中は保護されるので解けない').toBe(false)
    // 残っていれば 2,3,4 回目として数えられ最後が false になる
    expect(
      [1, 2, 3].map(() => consumeRateLimit(spare, LONG)),
      '制限内は追い出されカウンタが戻る',
    ).toEqual([true, true, true])
  })
})
