/**
 * メンテナンスモードの判定(サーバー専用)
 *
 * フラグは DB ではなく**ファイルの有無**で持つ。DB リストア中(DB が作り直されている間)でも
 * 遮断が効いている必要があるため、判定に DB を引かせない。セッションも見ないので全員が遮断される。
 *
 * 切り替えは `scripts/maintenance.mjs`(`pnpm maintenance on|off`)。アプリ側はここを読むだけで、
 * 画面から切り替える経路は用意していない(遮断中は Server Action も止まるため、自分で解除できない)。
 *
 * キャッシュの考え方は `command-catalog.ts` と同じ。「切り替えたぞ」を全プロセスへ伝播させる代わりに、
 * 各プロセスが自分でファイルの有無に追随する。反映までの遅れは
 * {@link MAINTENANCE_MODE_STAT_INTERVAL_MS} に収まる。
 */

import { existsSync } from 'node:fs'
import { envu } from '../env-util'
import { logger } from '../logger'
import { type MatchCondition } from '../match'
import { MAINTENANCE_MODE_STAT_INTERVAL_MS, MAINTENANCE_MODE_WATCH_MS } from './maintenance'

/**
 * 遮断の対象。
 *
 * `/api/health` は生かす。監視と `compose.yaml` の疎通確認がここを見ており、
 * 遮断してしまうとメンテナンス中にコンテナが落ちたのと区別が付かなくなる。
 * `/favicon.ico` はメンテナンス画面のタブアイコン(`_next/*` は matcher 側で除外済み)。
 */
export const MAINTENANCE_MODE_TARGET: MatchCondition = { exclude: ['/api/health', '/favicon.ico'] }

let cached = false
let checkedAt = 0

/** メンテナンスモード中か。リクエストごとに呼ばれるので stat は間隔を空ける */
export const isMaintenanceMode = (): boolean => {
  const now = Date.now()
  if (now - checkedAt < MAINTENANCE_MODE_STAT_INTERVAL_MS) {
    return cached
  }
  checkedAt = now
  cached = existsSync(envu.server.MAINTENANCE_MODE_FILE)
  return cached
}

/**
 * 接続を手放す前に終わりを待つ相手(ワーカー)。
 *
 * 登録の向きを「ワーカー → ここ」にしてあるのは、ここから各ワーカーを import すると
 * 循環参照になるため(ワーカー側が `isMaintenanceMode()` を読んでいる)。
 */
const drainSources: { name: string; isBusy: () => boolean }[] = []

/** 終わりを待つ相手を登録する。各ワーカーの `startXxxWorker()` から呼ぶ */
export const registerMaintenanceDrainSource = (name: string, isBusy: () => boolean): void => {
  drainSources.push({ name, isBusy })
}

/** まだ処理中の相手の名前。空なら接続を手放してよい */
const busyDrainSources = (): string[] => drainSources.filter(({ isBusy }) => isBusy()).map(({ name }) => name)

let watcher: NodeJS.Timeout | null = null
/**
 * 直前に観測した状態。**起動時点で ON でも遷移として扱う**ため、実際の状態ではなく false から始める。
 * 起動時から ON の場合も接続を解放しておかないと、リストア側の接続チェックに引っかかる。
 */
let watched = false
/** この遮断でもう接続を手放したか。OFF へ戻るまで1回だけ切る */
let disconnected = false

/**
 * 遮断中に Prisma の接続プールを解放する。
 *
 * 遮断しただけではアイドル接続が残り、`scripts/restore-db.mjs` の接続チェックに引っかかって
 * リストアが始められない。リクエストが来なくても切りたいので、監視は定期実行で回す。
 *
 * 切るのは**実行中のワーカーが全員終わってから**。tick の入口で弾けるのはこれから始まる周だけで、
 * 実行中のものは最後にログ・生存申告・終了状態を書く。先に切ると、その書き込みが接続を張り直して
 * リストア直前に復活してしまう。ここで待つことで「接続数 0」が「ワーカーも完了済み」を意味するようになり、
 * `restore-db.mjs --wait` がそのまま drain の関門になる(終わらなければ上限で中断する)。
 */
export const startMaintenanceModeWatcher = (): void => {
  if (watcher) {
    return
  }

  watcher = setInterval(() => {
    if (!isMaintenanceMode()) {
      if (watched) {
        watched = false
        disconnected = false
        logger.info('maintenance mode off')
      }
      return
    }

    if (!watched) {
      watched = true
      logger.info('maintenance mode on')
    }
    if (disconnected) {
      return
    }

    const busy = busyDrainSources()
    if (busy.length > 0) {
      logger.info({ busy }, 'maintenance mode: waiting for workers')
      return
    }

    disconnected = true
    logger.info('maintenance mode: workers idle, disconnecting prisma')
    // 上位で prisma を読ませないよう(proxy もこのファイルを読む)、使う直前に取り込む
    void import('../prisma')
      .then(({ prisma }) => prisma.$disconnect())
      .catch((error) => logger.error({ error }, 'prisma disconnect failed'))
  }, MAINTENANCE_MODE_WATCH_MS)
  watcher.unref()

  logger.info({ file: envu.server.MAINTENANCE_MODE_FILE }, 'maintenance mode watcher started')
}
