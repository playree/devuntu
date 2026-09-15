/**
 * SSE の Route Handler 共通処理(サーバー専用)
 *
 * ヘッダとカーソルの解釈だけを持つ純粋な部分。ストリームの組み立ては `command-stream.ts`。
 */

/**
 * SSE のレスポンスヘッダ。
 *
 * - `no-store` は既存の API と同じ流儀(`agent-api.ts`)
 * - `no-transform` は Next 同梱の compression に gzip させないため。Next はチャンクごとに
 *   `res.flush()` を呼ぶので gzip でも詰まらないが、中間の proxy まで含めて確実にする
 * - `X-Accel-Buffering: no` は nginx / Apache のバッファリングを止める。これが無いと
 *   proxy 側が数KB溜めるまで送出せず、進捗表示が飛び飛びになる
 */
export const sseHeaders = (): HeadersInit => ({
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
})

/**
 * 再開位置の解釈。
 *
 * 壊れた値は 0(先頭から)に倒す。全量が再送されるだけで、欠落や重複は起きない
 * (クライアントは seq で重複を弾く)。
 */
export const parseCursor = (raw: string | null): number => {
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}
