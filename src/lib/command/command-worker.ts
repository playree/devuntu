/**
 * リモート実行ワーカーの起動(サーバー専用)
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

import { envu } from '../env-util'
import { createWorkerLoop } from '../worker-loop'
import { COMMAND_START_DELAY_MS, COMMAND_TICK_MS } from './command'
import { runCommandDispatch } from './command-dispatch'
import { abortAllRuns, runningCount } from './command-registry'

const loop = createWorkerLoop({
  name: 'command',
  run: runCommandDispatch,
  failedMessage: 'command dispatch failed',
  intervalMs: COMMAND_TICK_MS,
  /**
   * 起動直後に走らせないのは、前回の実行が stale と判定されるまでの間に
   * 掴み直しを試みても意味が無いため。
   */
  startDelayMs: COMMAND_START_DELAY_MS,
  rerunPending: true,
  isEnabled: () => envu.server.COMMAND_EXEC_ENABLED && envu.server.COMMAND_WORKER_ENABLED,
  /**
   * `runCommandDispatch()` は実行の完走を待たずに返るので、dispatch 中かどうかだけでは足りない。
   * レジストリから外れるのは `command-exec.ts` の finally、つまり終了状態を書き終えた後なので、
   * `runningCount()` が 0 なら DB への書き込みも終わっている。
   */
  isBusy: () => runningCount() > 0,
  /**
   * 終了時は**同期的にできることだけ**行う。
   * Next 自身が SIGTERM で `process.exit(143)` するため DB の更新は間に合わない前提で、
   * 子プロセスを道連れにするに留める。running のまま残った行は stale 回収が閉じる。
   */
  onStart: () => {
    process.once('SIGTERM', () => abortAllRuns('interrupted'))
    process.once('SIGINT', () => abortAllRuns('interrupted'))
  },
})

/** 定期実行を開始する。サーバーインスタンスの起動時に1度だけ呼ぶ */
export const startCommandWorker = loop.start

/** レスポンス後に1周だけ回す。実行の開始が最大 `COMMAND_TICK_MS` 遅れるだけで落ちない */
export const kickCommandDispatch = loop.kick
