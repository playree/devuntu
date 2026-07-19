/**
 * Google アカウント連携用ユーティリティ
 */

/** カレンダー読み取り専用スコープ */
export const CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'

/** 連携時にアプリが要求するスコープ一覧（将来ここに追加していく） */
export const GOOGLE_LINK_SCOPES = [CALENDAR_READONLY_SCOPE]

/** スコープ文字列を表示用に整形する（googleapis の URL プレフィックスを除去） */
export const formatScopeLabel = (scope: string) => scope.replace(/^https:\/\/www\.googleapis\.com\/auth\//, '')
