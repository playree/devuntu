/**
 * 定期メンテナンスの定数と純関数(クライアント / サーバー共用)
 *
 * 掃除の判断はすべて「書き手が死んだと記録した列」(`expiresAt` / `revoked` など)に紐づける。
 * ここには prisma を持ち込まず、値と計算だけを置く。
 */

/** 掃除を回す間隔 */
export const MAINTENANCE_TICK_MS = 60 * 60 * 1000

/** 起動から最初の1周までの待ち。起動直後の負荷と重ねない */
export const MAINTENANCE_START_DELAY_MS = 60 * 1000

/**
 * 期限切れから実際に消すまでの猶予。
 *
 * 期限の判定と削除がずれても、処理中のリクエストが握っている行を消さないだけの幅を取る。
 */
export const SESSION_RETENTION_MS = 24 * 60 * 60 * 1000
export const VERIFICATION_RETENTION_MS = 24 * 60 * 60 * 1000
export const OAUTH_TOKEN_RETENTION_MS = 24 * 60 * 60 * 1000

/** 実行履歴を残す期間 */
export const AGENT_RUN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

/**
 * ランナー1台あたりに残す実行履歴の上限。期間内に積み上がった分への歯止め。
 *
 * `AGENT_RUN_HISTORY_LIMIT`(画面が出せる件数)を大きく超える値にして、
 * 表示できる範囲は必ずDBに残っている状態を保つ。
 */
export const AGENT_RUN_KEEP_PER_RUNNER = 500

/** コマンドの実行履歴を残す期間 */
export const COMMAND_RUN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

/**
 * コマンド1本あたりに残す実行履歴の上限。期間内に積み上がった分への歯止め。
 *
 * ログ(`command_run_chunk`)は実行1件あたり数千行になりうるので、
 * エージェントの実行履歴(500件)より絞ってある。
 */
export const COMMAND_RUN_KEEP_PER_COMMAND = 300

/** 添付の掃除を回す間隔。本文の全走査を伴うので tick ごとには行わない */
export const ATTACHMENT_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000

/** 本文・添付を引くときの1ページの件数 */
export const ATTACHMENT_SCAN_BATCH = 500

/** 1周で消す添付の上限。不具合があった場合の影響範囲を頭打ちにする */
export const ATTACHMENT_DELETE_MAX = 200

/** ID を集めてから消す手順での1回ぶんの件数 */
export const MAINTENANCE_DELETE_BATCH = 1000

/** 保持期間を過ぎた境界時刻。これより古いものが削除対象になる */
export const retentionBefore = (now: Date, ms: number): Date => new Date(now.getTime() - ms)
