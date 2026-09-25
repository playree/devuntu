/**
 * 定期メンテナンスの起動(サーバー専用)
 *
 * 通知ワーカーと分けているのは、通知の tick が10秒間隔かつリクエストごとにも駆動されるため。
 * 掃除を同じ tick に混ぜると、本文の走査とストレージへの往復が配信を待たせてしまう。
 * 止めたいときの単位も別なので、環境変数も分けている。
 *
 * 単一コンテナ前提だが、多重に走っても壊れない(削除はどれも冪等で、同時削除でも例外にならない)。
 */

import { envu } from '../env-util'
import { createWorkerLoop } from '../worker-loop'
import { MAINTENANCE_START_DELAY_MS, MAINTENANCE_TICK_MS } from './maintenance'
import { runMaintenanceSweep } from './maintenance-sweep'

const loop = createWorkerLoop({
  name: 'maintenance',
  run: runMaintenanceSweep,
  failedMessage: 'maintenance sweep failed',
  intervalMs: MAINTENANCE_TICK_MS,
  startDelayMs: MAINTENANCE_START_DELAY_MS,
  intervalFromFirstRun: true,
  // 前回が長引いているだけなので、重ねずに次の間隔で拾い直す
  rerunPending: false,
  isEnabled: () => envu.server.MAINTENANCE_WORKER_ENABLED,
})

/** 定期実行を開始する。サーバーインスタンスの起動時に1度だけ呼ぶ */
export const startMaintenanceWorker = loop.start
