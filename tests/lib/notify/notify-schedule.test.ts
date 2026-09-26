/**
 * 配信時刻の計算の単体テスト
 */

import { NOTIFY_EMAIL_WINDOW_MS, NOTIFY_MAX_ATTEMPTS, NOTIFY_RETRY_BASE_MS } from '@/lib/notify/notify'
import { isRetryExhausted, nextEmailWindowAt, retryScheduledAt } from '@/lib/notify/notify-schedule'
import { describe, expect, it } from 'vitest'

const now = new Date('2026-08-25T10:03:20.000Z')

describe('nextEmailWindowAt: メールの集約ウィンドウ', () => {
  it('次の境界へ丸める', () => {
    // 既定は5分幅。10:03:20 は 10:05:00 のウィンドウで送る
    expect(nextEmailWindowAt(now).toISOString()).toBe('2026-08-25T10:05:00.000Z')
  })

  it('同じ区間に発生した通知は同じ時刻へ寄る(1通にまとまる根拠)', () => {
    const first = nextEmailWindowAt(new Date('2026-08-25T10:00:00.001Z'))
    const last = nextEmailWindowAt(new Date('2026-08-25T10:04:59.999Z'))
    expect(first.getTime()).toBe(last.getTime())
  })

  it('境界のちょうどは次の区間の始まりとして扱う', () => {
    // その場で送ると直前の通知と別便になるので、境界では待たせる
    expect(nextEmailWindowAt(new Date('2026-08-25T10:05:00.000Z')).toISOString()).toBe('2026-08-25T10:10:00.000Z')
    expect(nextEmailWindowAt(new Date('2026-08-25T10:04:59.999Z')).toISOString()).toBe('2026-08-25T10:05:00.000Z')
    expect(nextEmailWindowAt(new Date('2026-08-25T10:05:00.001Z')).toISOString()).toBe('2026-08-25T10:10:00.000Z')
  })

  it('待ち時間はウィンドウ幅を超えない', () => {
    for (const ms of [0, 1, 123_456, 299_999]) {
      const at = new Date(Date.UTC(2026, 7, 25, 10, 0, 0) + ms)
      const wait = nextEmailWindowAt(at).getTime() - at.getTime()
      expect(wait).toBeGreaterThan(0)
      expect(wait).toBeLessThanOrEqual(NOTIFY_EMAIL_WINDOW_MS)
    }
  })
})

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
