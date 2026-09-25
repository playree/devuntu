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
 * 同じ行を2度処理しない)。ループの共通部分は `worker-loop.ts` にある。
 */

import { envu } from '../env-util'
import { createWorkerLoop } from '../worker-loop'
import { NOTIFY_TICK_MS } from './notify'
import { runNotifyDispatch } from './notify-dispatch'

const loop = createWorkerLoop({
  name: 'notify',
  run: runNotifyDispatch,
  failedMessage: 'notify dispatch failed',
  intervalMs: NOTIFY_TICK_MS,
  rerunPending: true,
  isEnabled: () => envu.server.NOTIFY_WORKER_ENABLED,
})

/** 定期実行を開始する。サーバーインスタンスの起動時に1度だけ呼ぶ */
export const startNotifyWorker = loop.start

/** レスポンス後に1周だけ回す。リクエスト文脈の外では interval に任せる */
export const kickNotifyDispatch = loop.kick
