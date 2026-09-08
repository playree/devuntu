/**
 * 配信時刻の計算
 *
 * 副作用を持たない計算だけを置く(単体テストで境界を固定するため)。
 */

import { NOTIFY_EMAIL_WINDOW_MS, NOTIFY_MAX_ATTEMPTS, NOTIFY_RETRY_BASE_MS } from './notify'

/**
 * メールを送る次のウィンドウ境界。
 *
 * エポックからの経過をウィンドウ幅で切り、次の境界へ丸める。同じ区間に発生した通知は
 * 同じ時刻へ寄るので、取り出しの時点でユーザー単位にまとめれば必ず 1 通になる。
 * 送信間隔を管理する状態(最終送信時刻など)を持たずに済むのがこの丸め方の狙い。
 *
 * ちょうど境界の時刻は「その区間の終わり」ではなく次の区間の始まりとして扱う
 * (`now` が境界と等しいとき、その場で送らずに次の境界まで待つ)。
 */
export const nextEmailWindowAt = (now: Date, windowMs: number = NOTIFY_EMAIL_WINDOW_MS): Date =>
  new Date(Math.floor(now.getTime() / windowMs) * windowMs + windowMs)

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
