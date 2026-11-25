/**
 * Wiki アナウンスの予約通知の起動(サーバー専用)
 *
 * 期限の来た予約を 1 分ごとに送る。投入した通知の配信は通知ワーカーが行うので、
 * 止める単位は通知と同じ環境変数にしている。
 *
 * 多重に走っても壊れない(予約の行を `FOR UPDATE SKIP LOCKED` で取り、status を見直してから送る)。
 */

import { MINUTE_MS } from '../day'
import { envu } from '../env-util'
import { createWorkerLoop } from '../worker-loop'
import { createWikiAnnouncementScheduleRunner } from './wiki-announcement-notify'
import { WIKI_ANNOUNCE_TICK_MS } from './wiki-announcement-notify-rule'

const loop = createWorkerLoop({
  name: 'wiki-announce',
  run: createWikiAnnouncementScheduleRunner(),
  failedMessage: 'wiki announcement schedule failed',
  intervalMs: WIKI_ANNOUNCE_TICK_MS,
  // 起動直後の負荷と重ねない
  startDelayMs: MINUTE_MS,
  intervalFromFirstRun: true,
  rerunPending: false,
  isEnabled: () => envu.server.NOTIFY_WORKER_ENABLED,
})

/** 定期実行を開始する。サーバーインスタンスの起動時に1度だけ呼ぶ */
export const startWikiAnnouncementWorker = loop.start
