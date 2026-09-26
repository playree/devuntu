/**
 * 定期メンテナンスの定数と純関数(クライアント / サーバー共用)
 *
 * 掃除の判断はすべて「書き手が死んだと記録した列」(`expiresAt` / `revoked` など)に紐づける。
 * ここには prisma も envu も持ち込まず、値と計算だけを置く。
 */

import { DAY_MS, HOUR_MS, MINUTE_MS } from '../day'

/** 掃除を回す間隔 */
export const MAINTENANCE_TICK_MS = HOUR_MS

/** 起動から最初の1周までの待ち。起動直後の負荷と重ねない */
export const MAINTENANCE_START_DELAY_MS = MINUTE_MS

/**
 * 期限切れから実際に消すまでの猶予。
 *
 * 期限の判定と削除がずれても、処理中のリクエストが握っている行を消さないだけの幅を取る。
 */
export const SESSION_RETENTION_MS = DAY_MS
export const VERIFICATION_RETENTION_MS = DAY_MS
export const OAUTH_TOKEN_RETENTION_MS = DAY_MS

// 実行履歴の保持(期間と件数)は運用者が変えられるようにしてあるので `envu.server` 側にある

/** 添付の掃除を回す間隔。本文の全走査を伴うので tick ごとには行わない */
export const ATTACHMENT_SWEEP_INTERVAL_MS = DAY_MS

/** 本文・添付を引くときの1ページの件数 */
export const ATTACHMENT_SCAN_BATCH = 500

/** 1周で消す添付の上限。不具合があった場合の影響範囲を頭打ちにする */
export const ATTACHMENT_DELETE_MAX = 200

/** ID を集めてから消す手順での1回ぶんの件数 */
export const MAINTENANCE_DELETE_BATCH = 1000

// ここから下は掃除ではなく、リストア中に全アクセスを遮断する「メンテナンスモード」の定数

/** フラグファイルの有無を見に行く間隔。これがリクエストごとの stat 回数の上限になる */
export const MAINTENANCE_MODE_STAT_INTERVAL_MS = 1000

/** OFF→ON の遷移を拾う間隔。`scripts/restore-all.mjs` の接続解放待ちはこの2周ぶん */
export const MAINTENANCE_MODE_WATCH_MS = 5 * 1000

/** 遮断時に返す `Retry-After`(秒)。リストアが数分で終わる想定の目安 */
export const MAINTENANCE_MODE_RETRY_AFTER_SEC = 120
