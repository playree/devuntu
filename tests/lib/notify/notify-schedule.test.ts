/**
 * 配信時刻の計算の単体テスト
 */

import { NOTIFY_MAX_ATTEMPTS, NOTIFY_RETRY_BASE_MS } from '@/lib/notify/notify'
import { isRetryExhausted, retryScheduledAt, staleClaimBefore } from '@/lib/notify/notify-schedule'
import { describe, expect, it } from 'vitest'

const now = new Date('2026-08-25T10:03:20.000Z')

describe('retryScheduledAt: 再試行の待ち時間', () => {
  it('試行回数に比例して延びる', () => {
    expect(retryScheduledAt(now, 1).getTime() - now.getTime()).toBe(NOTIFY_RETRY_BASE_MS)
    expect(retryScheduledAt(now, 2).getTime() - now.getTime()).toBe(NOTIFY_RETRY_BASE_MS * 2)
  })

  it('0 や負の試行回数でも過去にはしない', () => {
    // claim 時の加算を戻した直後などに 0 が渡りうる
    expect(retryScheduledAt(now, 0).getTime()).toBeGreaterThan(now.getTime())
  })
})

describe('isRetryExhausted: 諦める境界', () => {
  it('上限に達したら諦める', () => {
    expect(isRetryExhausted(NOTIFY_MAX_ATTEMPTS - 1)).toBe(false)
    expect(isRetryExhausted(NOTIFY_MAX_ATTEMPTS)).toBe(true)
  })
})

describe('staleClaimBefore: 取りこぼしの境界', () => {
  it('指定した時間だけ過去へ戻す', () => {
    expect(staleClaimBefore(now, 300_000).toISOString()).toBe('2026-08-25T09:58:20.000Z')
  })
})
