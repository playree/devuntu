/**
 * 期限のリマインドの起動(サーバー専用)
 *
 * 通知ワーカーと分けているのは、通知の tick が10秒間隔かつリクエストごとにも駆動されるため。
 * 期限の近いチケットを引く処理を毎回混ぜる必要は無く、送る時刻からの遅れは数分で足りる。
 * 投入した通知の配信は通知ワーカーが行うので、止める単位は通知と同じ環境変数にしている。
 *
 * 単一コンテナ前提だが、多重に走っても壊れない(送信済みの記録の一意制約で二重に投入しない)。
 */

import { MINUTE_MS } from '../day'
import { envu } from '../env-util'
import { createWorkerLoop } from '../worker-loop'
import { DUE_REMIND_TICK_MS } from './notify'
import { runDueRemind } from './notify-due'

const loop = createWorkerLoop({
  name: 'due-remind',
  run: () => runDueRemind(),
  failedMessage: 'due remind failed',
  intervalMs: DUE_REMIND_TICK_MS,
  // 起動直後の負荷と重ねない
  startDelayMs: MINUTE_MS,
  intervalFromFirstRun: true,
  rerunPending: false,
  isEnabled: () => envu.server.NOTIFY_WORKER_ENABLED,
})

/** 定期実行を開始する。サーバーインスタンスの起動時に1度だけ呼ぶ */
export const startDueRemindWorker = loop.start
