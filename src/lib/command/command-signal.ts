/**
 * 実行の進捗をSSEハンドラへ知らせる合図(サーバー専用)
 *
 * **これは最適化であって、正しさの担保ではない。** SSE 側は DB をポーリングするだけで
 * 完全に動作し、この合図は表示の遅れを1秒から数msへ縮めるためだけにある。
 *
 * NOTE: プロセス内の EventEmitter なので、水平スケールすると別インスタンスの SSE には届かない。
 *       届かなくてもポーリングが拾うので表示が最大 `COMMAND_SSE_POLL_MS` ぶん遅れるだけ。
 *       共有が必要になったら PostgreSQL の LISTEN/NOTIFY などへこのファイルだけを差し替える
 *       (`rate-limit.ts` / `cache.ts` と同じ扱い)。
 */

import { EventEmitter } from 'node:events'

const emitter = new EventEmitter()
// 同じ実行を複数のタブで見ることがあるので、既定の10件では警告が出る
emitter.setMaxListeners(0)

/** 進捗があったことを知らせる */
export const signalRun = (runId: string): void => {
  emitter.emit(runId)
}

/**
 * 合図・タイムアウト・切断のいずれか早い方まで待つ。
 *
 * 合図が来なくても必ず `timeoutMs` で戻るので、呼び出し側はここを「ポーリングの待ち」として扱える。
 */
export const waitForRunSignal = (runId: string, timeoutMs: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }

    const done = () => {
      clearTimeout(timer)
      emitter.off(runId, done)
      signal.removeEventListener('abort', done)
      resolve()
    }

    const timer = setTimeout(done, timeoutMs)
    // Node の終了を妨げない
    timer.unref?.()
    emitter.once(runId, done)
    signal.addEventListener('abort', done, { once: true })
  })
