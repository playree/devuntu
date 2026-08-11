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

type Counter = { count: number; resetAt: number }

/**
 * 固定ウィンドウのカウンタ。
 * Next.js の dev では モジュールが再評価されうるが、その場合は単に制限が緩むだけなので許容する。
 */
const counters = new Map<string, Counter>()

/** 保持するカウンタ数の上限 */
export const MAX_ENTRIES = 10000

/**
 * 上限を超えた分を捨てる。ウィンドウ明けを先に落とし、それでも収まらなければ古い順(Map の挿入順)に削る。
 * 期限切れの掃除だけだと、キーを変え続ける試行で有効なカウンタだけが積み上がってしまう。
 *
 * 有効なカウンタを捨てるとそのキーの制限は緩むため、発生したことは分かるようにしておく。
 */
const evict = (now: number) => {
  for (const [key, counter] of counters) {
    if (counter.resetAt <= now) {
      counters.delete(key)
    }
  }

  let dropped = 0
  for (const key of counters.keys()) {
    if (counters.size < MAX_ENTRIES) {
      break
    }
    counters.delete(key)
    dropped += 1
  }
  if (dropped > 0) {
    logger.warn({ dropped, max: MAX_ENTRIES }, 'rate limit counters evicted')
  }
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
    counters.set(key, { count: 1, resetAt: now + windowMs })
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
