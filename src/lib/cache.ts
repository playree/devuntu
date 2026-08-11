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

/** 保持するエントリ数の上限 */
const MAX_ENTRIES = 1000

/**
 * 上限を超えた分を捨てる。期限切れを先に落とし、それでも収まらなければ古い順(Map の挿入順)に削る。
 * 期限切れの掃除だけだと、キーを変え続けるリクエストで有効なエントリだけが積み上がってしまう。
 */
const evict = (now: number) => {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) {
      entries.delete(key)
    }
  }
  for (const key of entries.keys()) {
    if (entries.size < MAX_ENTRIES) {
      break
    }
    entries.delete(key)
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

  const entry = entries.get(key)
  if (entry && entry.expiresAt > now) {
    return entry.value as Promise<T>
  }

  if (entries.size >= MAX_ENTRIES) {
    evict(now)
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
