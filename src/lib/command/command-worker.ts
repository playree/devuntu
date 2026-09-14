/**
 * コマンド実行ワーカーの起動(サーバー専用)
 *
 * `notify-worker.ts` と同じ二重の駆動で回す。
 *
 * - **kick** : 投入直後に `after()` でレスポンス後の1周を予約する。押してから動き出すまでの
 *   待ちを tick 間隔ぶん待たせないためで、通常はこちらだけで実行が始まる
 * - **tick** : `setInterval` の定期実行。kick が使えなかった分と、中断要求・stale 回収を拾う保険
 *
 * `after()` に入れるのは**1 tick だけ**で、実行の完走は入れない。セルフホストでは
 * `nextServer.close()` が `after()` の完了を待つため、長時間のジョブを入れると
 * その時間ぶん graceful shutdown が止まる。
 */

import { after } from 'next/server'
import { envu } from '../env-util'
import { logger } from '../logger'
import { COMMAND_START_DELAY_MS, COMMAND_TICK_MS } from './command'
import { runCommandDispatch } from './command-dispatch'
import { abortAllRuns } from './command-registry'

let timer: NodeJS.Timeout | null = null
let running = false
/** 実行中に来た駆動要求。取りこぼさないよう終わってからもう1周する */
let pending = false

const tick = async (): Promise<void> => {
  if (running) {
    pending = true
    return
  }
  running = true
  try {
    do {
      pending = false
      await runCommandDispatch()
    } while (pending)
  } catch (error) {
    // ワーカーを止めない。次の tick で拾い直す
    logger.error({ error }, 'command dispatch failed')
  } finally {
    running = false
  }
}

/**
 * 定期実行を開始する。サーバーインスタンスの起動時に1度だけ呼ぶ。
 *
 * 起動直後に走らせないのは、前回の実行が stale と判定されるまでの間に
 * 掴み直しを試みても意味が無いため。
 */
export const startCommandWorker = (): void => {
  if (timer) {
    return
  }
  if (!envu.server.COMMAND_EXEC_ENABLED || !envu.server.COMMAND_WORKER_ENABLED) {
    logger.info('command worker disabled')
    return
  }

  setTimeout(() => void tick(), COMMAND_START_DELAY_MS).unref()
  timer = setInterval(() => void tick(), COMMAND_TICK_MS)
  // プロセスの終了を妨げないようにする
  timer.unref()

  /**
   * 終了時は**同期的にできることだけ**行う。
   * Next 自身が SIGTERM で `process.exit(143)` するため DB の更新は間に合わない前提で、
   * 子プロセスを道連れにするに留める。running のまま残った行は stale 回収が閉じる。
   */
  process.once('SIGTERM', () => abortAllRuns('interrupted'))
  process.once('SIGINT', () => abortAllRuns('interrupted'))

  logger.info({ intervalMs: COMMAND_TICK_MS }, 'command worker started')
}

/**
 * レスポンス後に1周だけ回す。
 *
 * `after()` はリクエスト文脈の外では使えないので、その場合は握り潰して interval に任せる
 * (実行の開始が最大 `COMMAND_TICK_MS` 遅れるだけ)。
 */
export const kickCommandDispatch = (): void => {
  if (!envu.server.COMMAND_EXEC_ENABLED || !envu.server.COMMAND_WORKER_ENABLED) {
    return
  }
  try {
    after(() => tick())
  } catch {
    // リクエスト文脈の外。次の tick が拾う
  }
}
