/**
 * バックグラウンドワーカーの定期実行ループ(サーバー専用)
 *
 * 通知 / リモート実行 / 定期メンテナンスで共通の部分をまとめる。
 *
 * - 同一プロセス内で 1 周を重ねない(多重に走っても壊れない作りだが、無駄な重なりを防ぐ)
 * - メンテナンス中は DB を触らない(残ったアイドル接続がリストアを妨げる)
 * - 1 周の失敗でワーカーを止めない(次の tick で拾い直す)
 * - 実行中はメンテナンスモードの切り替えを待たせる(途中で接続を切ると後続の更新が接続を張り直す)
 */

import { after } from 'next/server'
import { logger } from './logger'
import { isMaintenanceMode, registerMaintenanceDrainSource } from './maintenance/maintenance-mode'

type WorkerLoopOptions = {
  /** ログとドレインの登録に使う名前 */
  name: string
  run: () => Promise<unknown>
  /** 1 周が失敗したときのログの文言 */
  failedMessage: string
  intervalMs: number
  /** 初回を起動からどれだけ遅らせるか。未指定なら最初の間隔まで待つ */
  startDelayMs?: number
  /** 間隔を初回の後から刻む。false なら起動時から刻み、初回はそれとは別に走らせる */
  intervalFromFirstRun?: boolean
  /** 実行中に来た駆動要求を、終わってからもう 1 周して拾うか。false なら次の間隔まで待つ */
  rerunPending: boolean
  isEnabled: () => boolean
  /** tick の外で続く処理があるときに、実行中の判定へ足す */
  isBusy?: () => boolean
  /** 起動時に 1 度だけ行う追加の処理 */
  onStart?: () => void
}

export const createWorkerLoop = (opts: WorkerLoopOptions) => {
  let started = false
  let running = false
  /** 実行中に来た駆動要求。取りこぼさないよう終わってからもう 1 周する */
  let pending = false

  const tick = async (): Promise<void> => {
    if (isMaintenanceMode()) {
      return
    }
    if (running) {
      pending = opts.rerunPending
      return
    }
    running = true
    try {
      do {
        pending = false
        await opts.run()
      } while (pending)
    } catch (error) {
      logger.error({ error }, opts.failedMessage)
    } finally {
      running = false
    }
  }

  /**
   * 定期実行を開始する。サーバーインスタンスの起動時に 1 度だけ呼ぶ。
   * `next dev` ではモジュールが再評価されうるが、その場合も二重にタイマーは張らない。
   */
  const start = (): void => {
    if (started) {
      return
    }
    if (!opts.isEnabled()) {
      logger.info(`${opts.name} worker disabled`)
      return
    }
    started = true

    // タイマーはすべてプロセスの終了を妨げないようにする
    const startInterval = () => setInterval(() => void tick(), opts.intervalMs).unref()
    if (opts.startDelayMs === undefined) {
      startInterval()
    } else if (opts.intervalFromFirstRun) {
      setTimeout(() => {
        void tick()
        startInterval()
      }, opts.startDelayMs).unref()
    } else {
      setTimeout(() => void tick(), opts.startDelayMs).unref()
      startInterval()
    }

    opts.onStart?.()
    registerMaintenanceDrainSource(opts.name, () => running || (opts.isBusy?.() ?? false))

    logger.info({ intervalMs: opts.intervalMs }, `${opts.name} worker started`)
  }

  /**
   * レスポンス後に 1 周だけ回す。
   *
   * `after()` はリクエスト文脈の外では使えないので、その場合は握り潰して定期実行に任せる
   * (処理が次の間隔まで遅れるだけで落ちない)。
   */
  const kick = (): void => {
    if (!opts.isEnabled()) {
      return
    }
    try {
      after(() => tick())
    } catch {
      // リクエスト文脈の外。次の tick が拾う
    }
  }

  return { start, kick }
}
