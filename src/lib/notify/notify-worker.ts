/**
 * 通知ワーカーの起動(サーバー専用)
 *
 * 二重の駆動で回す。
 *
 * - **kick** : 投入直後に `after()` でレスポンス後の1周を予約する。即時に送りたい通知が
 *   tick を待たされないようにするためで、通常はこちらだけで配信が終わる
 * - **tick** : `setInterval` の定期実行。kick が使えなかった分(リクエスト文脈の外からの投入)と、
 *   再試行・取りこぼしの回収を拾う保険
 *
 * 単一コンテナ前提だが、多重に走っても壊れない(取り出しが `FOR UPDATE SKIP LOCKED` なので
 * 同じ行を2度処理しない)。ここでのフラグは同一プロセス内の無駄な重なりを防ぐためのもの。
 */

import { after } from 'next/server'
import { envu } from '../env-util'
import { logger } from '../logger'
import { isMaintenanceMode, registerMaintenanceDrainSource } from '../maintenance/maintenance-mode'
import { NOTIFY_TICK_MS } from './notify'
import { runNotifyDispatch } from './notify-dispatch'

let timer: NodeJS.Timeout | null = null
let running = false
/** 実行中に来た駆動要求。取りこぼさないよう終わってからもう1周する */
let pending = false

const tick = async (): Promise<void> => {
  // メンテナンス中は DB を触らない。残ったアイドル接続がリストアを妨げる
  if (isMaintenanceMode()) {
    return
  }
  if (running) {
    pending = true
    return
  }
  running = true
  try {
    do {
      pending = false
      await runNotifyDispatch()
    } while (pending)
  } catch (error) {
    // ワーカーを止めない。次の tick で拾い直す
    logger.error({ error }, 'notify dispatch failed')
  } finally {
    running = false
  }
}

/**
 * 定期実行を開始する。サーバーインスタンスの起動時に1度だけ呼ぶ。
 *
 * `next dev` ではモジュールが再評価されうるが、その場合も `timer` の有無で二重の
 * interval は張らない。
 */
export const startNotifyWorker = (): void => {
  if (timer) {
    return
  }
  if (!envu.server.NOTIFY_WORKER_ENABLED) {
    logger.info('notify worker disabled')
    return
  }

  // プロセスの終了を妨げないようにする
  timer = setInterval(() => void tick(), NOTIFY_TICK_MS)
  timer.unref()

  // 配信の途中で接続を切られると、配信後の更新が接続を張り直してリストアを妨げる
  registerMaintenanceDrainSource('notify', () => running)

  logger.info({ intervalMs: NOTIFY_TICK_MS }, 'notify worker started')
}

/**
 * レスポンス後に1周だけ回す。
 *
 * `after()` はリクエスト文脈の外では使えないので、その場合は握り潰して interval に任せる
 * (通知が遅れるだけで落ちない)。
 */
export const kickNotifyDispatch = (): void => {
  if (!envu.server.NOTIFY_WORKER_ENABLED) {
    return
  }
  try {
    after(() => tick())
  } catch {
    // リクエスト文脈の外。次の tick が拾う
  }
}
