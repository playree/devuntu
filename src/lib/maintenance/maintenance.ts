/**
 * 定期メンテナンスの定数と純関数(クライアント / サーバー共用)
 *
 * 掃除の判断はすべて「書き手が死んだと記録した列」(`expiresAt` / `revoked` など)に紐づける。
 * ここには prisma も envu も持ち込まず、値と計算だけを置く。
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

// 実行履歴の保持(期間と件数)は運用者が変えられるようにしてあるので `envu.server` 側にある

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
