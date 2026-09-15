/**
 * 実行の1 tick(サーバー専用)
 *
 * 起動方法に依存しない形にしてある(`notify-dispatch.ts` と同じ切り分け)。
 * `command-worker.ts` の interval からも、将来 HTTP から叩く場合も、同じものを呼べばよい。
 *
 * **実行の完走は待たない。** tick を短く保ち、実行はプロセスの寿命の側に置く。
 * Server Action や `after()` の中で完走させると、長時間のジョブが
 * graceful shutdown をその時間ぶんブロックしてしまう。
 */

import { nowDate } from '../day'
import { envu } from '../env-util'
import { logger } from '../logger'
import { type CommandInputValues } from './command'
import { findCommandDef, findCommandTarget } from './command-catalog'
import { applyCancel, executeCommandRun } from './command-exec'
import { appendSystemChunk } from './command-log'
import { runningCount } from './command-registry'
import { claimQueuedRuns, finishCommandRun, listCancelRequestedRuns, reclaimStaleRuns } from './command-run'

/**
 * このプロセスの識別子。
 *
 * 再起動すると変わるので、「前回の自分が掴んだままの行」と「他プロセスが掴んでいる行」を
 * 見分けられる。回収は生存申告の時刻で判断するため、この値の一意性には依存しない。
 */
export const WORKER_ID = `${process.pid}-${Date.now().toString(36)}`

export const runCommandDispatch = async (now: Date = nowDate()): Promise<void> => {
  if (!envu.server.COMMAND_EXEC_ENABLED) {
    return
  }

  // 掴み手が消えた行を先に閉じる。放っておくと activeKey が居座り同じコマンドを実行できなくなる
  await reclaimStaleRuns(now)

  // 中断要求は自分が掴んでいる分だけ拾う。他プロセスの子プロセスは kill できない
  const canceling = await listCancelRequestedRuns(WORKER_ID)
  canceling.forEach((runId) => applyCancel(runId))

  const slots = envu.server.COMMAND_MAX_CONCURRENT - runningCount()
  if (slots <= 0) {
    return
  }

  const claimed = await claimQueuedRuns(slots, WORKER_ID)
  for (const run of claimed) {
    const def = findCommandDef(run.commandKey)
    const target = def ? findCommandTarget(def.targetId) : null
    if (!def || !target) {
      // 待っている間に定義ファイルから消えた / 壊れた
      await appendSystemChunk(run.id, '実行しようとした定義が見つかりません。定義ファイルを確認してください。')
      await finishCommandRun({
        runId: run.id,
        workerId: WORKER_ID,
        status: 'failed',
        exitCode: null,
        failureKind: 'start_failed',
      })
      continue
    }

    // await しない。executor が自分で終了を記録し、registry から外れる
    void executeCommandRun({
      runId: run.id,
      workerId: WORKER_ID,
      def,
      target,
      params: (run.params ?? {}) as CommandInputValues,
    }).catch((error: unknown) => {
      logger.error({ error, runId: run.id }, 'command run crashed')
    })
  }
}
