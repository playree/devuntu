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
 * `/api/health` だけは生かす。監視と `compose.yaml` の疎通確認がここを見ており、
 * 遮断してしまうとメンテナンス中にコンテナが落ちたのと区別が付かなくなる。
 */
export const MAINTENANCE_MODE_TARGET: MatchCondition = { exclude: ['/api/health'] }

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

let watcher: NodeJS.Timeout | null = null
let watched = false

/**
 * OFF→ON の遷移で Prisma の接続プールを解放する。
 *
 * 遮断しただけではアイドル接続が残り、`scripts/restore-db.mjs` の接続チェックに引っかかって
 * リストアが始められない。リクエストが来なくても切りたいので、監視は定期実行で回す。
 */
export const startMaintenanceModeWatcher = (): void => {
  if (watcher) {
    return
  }
  watched = isMaintenanceMode()

  watcher = setInterval(() => {
    const current = isMaintenanceMode()
    if (current === watched) {
      return
    }
    watched = current
    if (!current) {
      logger.info('maintenance mode off')
      return
    }
    logger.info('maintenance mode on: disconnecting prisma')
    // 上位で prisma を読ませないよう(proxy もこのファイルを読む)、使う直前に取り込む
    void import('../prisma')
      .then(({ prisma }) => prisma.$disconnect())
      .catch((error) => logger.error({ error }, 'prisma disconnect failed'))
  }, MAINTENANCE_MODE_WATCH_MS)
  watcher.unref()

  logger.info({ file: envu.server.MAINTENANCE_MODE_FILE }, 'maintenance mode watcher started')
}
