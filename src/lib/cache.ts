/**
 * 簡易 TTL キャッシュ(サーバー専用)
 *
 * 未認証で開ける公開ページから外部 API を呼ぶ経路を、リクエストごとの実行にしないためのもの。
 *
 * NOTE: rate-limit.ts と同様にカウンタはプロセス内メモリなので、水平スケールすると
 *       インスタンスごとのキャッシュになる。共有が必要になったら Redis などへ差し替えること。
 */

type Entry = { value: Promise<unknown>; expiresAt: number }

const entries = new Map<string, Entry>()

/** Map が無制限に膨らまないよう、この件数を超えたら期限切れを掃除する */
const PRUNE_THRESHOLD = 1000

const prune = (now: number) => {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) {
      entries.delete(key)
    }
  }
}

/**
 * `key` の値を `ttlMs` の間だけ使い回す。未取得・期限切れなら `load` で取得する。
 *
 * 取得結果ではなく Promise を保持するので、同時に届いたリクエストは 1 回の `load` に合流する
 * (公開ページへ一斉にアクセスされたときに外部 API を並列で叩かないため)。
 * `load` が失敗した場合はキャッシュに残さない。
 */
export const cached = <T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> => {
  const now = Date.now()
  if (entries.size > PRUNE_THRESHOLD) {
    prune(now)
  }

  const entry = entries.get(key)
  if (entry && entry.expiresAt > now) {
    return entry.value as Promise<T>
  }

  const value: Promise<T> = load().catch((error: unknown) => {
    // 後続のリクエストで取得し直せるよう、失敗した Promise は残さない
    if (entries.get(key)?.value === value) {
      entries.delete(key)
    }
    throw error
  })
  entries.set(key, { value, expiresAt: now + ttlMs })
  return value
}
