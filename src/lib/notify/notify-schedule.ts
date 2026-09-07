/**
 * 配信時刻の計算
 *
 * 副作用を持たない計算だけを置く(単体テストで境界を固定するため)。
 */

import { NOTIFY_MAX_ATTEMPTS, NOTIFY_RETRY_BASE_MS } from './notify'

/**
 * 再試行の待ち時間。数回で諦めるので指数ではなく試行回数に比例させる。
 * `attempts` は claim 時に加算済みの値(1 回目の失敗なら 1)。
 */
export const retryScheduledAt = (now: Date, attempts: number): Date =>
  new Date(now.getTime() + Math.max(1, attempts) * NOTIFY_RETRY_BASE_MS)

/** 試行回数を使い切ったか。使い切った配信は failed にして原因追跡用に残す */
export const isRetryExhausted = (attempts: number): boolean => attempts >= NOTIFY_MAX_ATTEMPTS

/** `processing` のまま放置された行を取りこぼしとみなす境界 */
export const staleClaimBefore = (now: Date, timeoutMs: number): Date => new Date(now.getTime() - timeoutMs)
