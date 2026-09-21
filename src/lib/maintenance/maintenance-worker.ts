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
import { logger } from '../logger'
import { MAINTENANCE_START_DELAY_MS, MAINTENANCE_TICK_MS } from './maintenance'
import { isMaintenanceMode } from './maintenance-mode'
import { runMaintenanceSweep } from './maintenance-sweep'

let started = false
let running = false

const tick = async (): Promise<void> => {
  // メンテナンス中は DB を触らない。残ったアイドル接続がリストアを妨げる
  if (isMaintenanceMode()) {
    return
  }
  // 前回が長引いているだけなので、次の間隔で拾い直す
  if (running) {
    return
  }
  running = true
  try {
    await runMaintenanceSweep()
  } catch (error) {
    // ワーカーを止めない。次の tick でやり直す
    logger.error({ error }, 'maintenance sweep failed')
  } finally {
    running = false
  }
}

/** 定期実行を開始する。サーバーインスタンスの起動時に1度だけ呼ぶ */
export const startMaintenanceWorker = (): void => {
  if (started) {
    return
  }
  if (!envu.server.MAINTENANCE_WORKER_ENABLED) {
    logger.info('maintenance worker disabled')
    return
  }
  started = true

  // プロセスの終了を妨げないようにする
  setTimeout(() => {
    void tick()
    setInterval(() => void tick(), MAINTENANCE_TICK_MS).unref()
  }, MAINTENANCE_START_DELAY_MS).unref()

  logger.info({ intervalMs: MAINTENANCE_TICK_MS }, 'maintenance worker started')
}
