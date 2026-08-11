/**
 * 簡易レートリミッタ(サーバー専用)
 *
 * better-auth の rateLimit は `/api/auth/*` を通る HTTP リクエストにしか掛からない。
 * Server Action から `auth.api.*` をサーバー内部呼び出しする経路(未認証で叩ける
 * `getUserByEmail` → OTP メール送信など)はその外側なので、ここで自前に制限する。
 *
 * NOTE: カウンタはプロセス内メモリなので、水平スケールするとインスタンスごとの制限になる。
 *       複数インスタンス構成にする場合は Redis などの共有ストアへ差し替えること。
 */

import { errTooManyRequests } from './error'
import { logger } from './logger'

export type RateLimitRule = {
  /** ウィンドウ内に許可する回数 */
  limit: number
  /** ウィンドウ長(ミリ秒) */
  windowMs: number
}

/** `limit` は追い出しの優先度判定(制限超過中かどうか)に使うため、カウンタ側にも持たせる */
type Counter = { count: number; resetAt: number; limit: number }

/**
 * 固定ウィンドウのカウンタ。
 * Next.js の dev では モジュールが再評価されうるが、その場合は単に制限が緩むだけなので許容する。
 */
const counters = new Map<string, Counter>()

/** 保持するカウンタ数の上限 */
export const MAX_ENTRIES = 10000

/** 追い出しの警告を出す最短間隔。キーを変え続ける試行で 1 リクエストごとに warn しないため */
const EVICT_WARN_INTERVAL_MS = 60 * 1000

let pendingWarn = { dropped: 0, blocked: 0 }
let lastWarnAt = 0

/**
 * 追い出しの発生を警告する。間隔内の分は次の警告までまとめる。
 * `blocked`(制限超過中だったカウンタ)が出ている場合はそのキーの制限が緩んでいる。
 */
const warnEvicted = (now: number, dropped: number, blocked: number) => {
  if (dropped === 0) {
    return
  }
  pendingWarn = { dropped: pendingWarn.dropped + dropped, blocked: pendingWarn.blocked + blocked }
  if (now - lastWarnAt < EVICT_WARN_INTERVAL_MS) {
    return
  }
  lastWarnAt = now
  logger.warn({ ...pendingWarn, max: MAX_ENTRIES }, 'rate limit counters evicted')
  pendingWarn = { dropped: 0, blocked: 0 }
}

/** 上限を下回るまで、条件に合うカウンタを古い順(Map の挿入順)に捨てる */
const dropOldest = (match: (counter: Counter) => boolean): number => {
  let dropped = 0
  for (const [key, counter] of counters) {
    if (counters.size < MAX_ENTRIES) {
      break
    }
    if (match(counter)) {
      counters.delete(key)
      dropped += 1
    }
  }
  return dropped
}

/**
 * 上限を超えた分を捨てる。ウィンドウ明け → 制限内 → 制限超過中 の順に落とす。
 * 期限切れの掃除だけだと、キーを変え続ける試行で有効なカウンタだけが積み上がってしまう。
 *
 * 制限超過中のカウンタを最後に回すのは、それを捨てるとブロック中の IP / メールの制限が解けるため。
 * 使い捨てのキー(1 回しか使われず制限内のまま)を先に捨てることで、流入でブロックを外させない。
 */
const evict = (now: number) => {
  for (const [key, counter] of counters) {
    if (counter.resetAt <= now) {
      counters.delete(key)
    }
  }

  const dropped = dropOldest((counter) => counter.count <= counter.limit)
  const blocked = dropOldest(() => true)
  warnEvicted(now, dropped + blocked, blocked)
}

/**
 * 1 回ぶん消費して、まだ制限内かを返す。制限を超えている場合は false。
 * `key` は用途とスコープを含めて一意にすること(例: `otp:ip:1.2.3.4`)。
 */
export const consumeRateLimit = (key: string, { limit, windowMs }: RateLimitRule): boolean => {
  const now = Date.now()

  const counter = counters.get(key)
  if (!counter || counter.resetAt <= now) {
    if (counters.size >= MAX_ENTRIES) {
      evict(now)
    }
    counters.set(key, { count: 1, resetAt: now + windowMs, limit })
    return true
  }

  counter.count += 1
  return counter.count <= limit
}

/**
 * 1 回ぶん消費し、超過していれば TOO_MANY_REQUESTS を throw する。
 * 呼び出し順に意味があるので、重い処理(DB 参照・メール送信)より前に置くこと。
 */
export const assertRateLimit = (key: string, rule: RateLimitRule): void => {
  if (!consumeRateLimit(key, rule)) {
    // key はメールアドレス / IP を含むので、`:` より前の用途名だけを残す
    logger.warn({ scope: key.split(':')[0], limit: rule.limit }, 'rate limit exceeded')
    throw errTooManyRequests()
  }
}
