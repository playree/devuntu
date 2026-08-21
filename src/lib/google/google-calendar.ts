/**
 * Google アカウント連携用ユーティリティ
 *
 * NOTE: このファイルはクライアント('use client')からも import されるため、
 * サーバー専用の処理(prisma / Google API 呼び出しなど)は `google-calendar-server.ts` に配置する。
 */

/** カレンダー連携用の OAuth プロバイダ ID(ログイン用の 'google' とは分離) */
export const GOOGLE_ACCOUNT_PROVIDER_ID = 'google-account'

/** カレンダー読み取り専用スコープ */
export const CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'

/** スコープ文字列を表示用に整形する（googleapis の URL プレフィックスを除去） */
export const formatScopeLabel = (scope: string) => scope.replace(/^https:\/\/www\.googleapis\.com\/auth\//, '')

/** FreeBusy の予定あり区間 */
export type BusySlot = { start: string; end: string }
