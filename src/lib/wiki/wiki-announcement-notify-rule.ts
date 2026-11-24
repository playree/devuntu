/**
 * Wiki アナウンスの Slack 通知の定数と純粋な判定(クライアント・サーバー共用)
 */

import type { WikiAnnouncementNotifyStatus } from '@/generated/prisma/enums'
import { DAY_MS, MINUTE_MS } from '../day'
import { hasWikiRole, type WikiRole } from './wiki-rule'

/** 一言の最大長。Slack へは `announcementText()` で同じ長さに丸める */
export const MAX_WIKI_ANNOUNCE_MESSAGE = 2000

/** 予約できる先の上限 */
export const MAX_WIKI_ANNOUNCE_SCHEDULE_MS = 365 * DAY_MS

/** 予約の時刻の刻み(分) */
export const WIKI_ANNOUNCE_TIME_STEP_MIN = 15

/** 予約を見るワーカーの間隔 */
export const WIKI_ANNOUNCE_TICK_MS = MINUTE_MS

/** ワーカーが 1 周で送る予約の上限。候補もこの件数ずつ読む */
export const WIKI_ANNOUNCE_BATCH = 50

/** ワーカーが 1 周で読む候補の上限(送れない予約が溜まっても 1 周の仕事量を抑える) */
export const WIKI_ANNOUNCE_SCAN_MAX = WIKI_ANNOUNCE_BATCH * 10

/** 1 ページに置ける予約中の通知の上限 */
export const MAX_WIKI_ANNOUNCE_SCHEDULED_PER_PAGE = 10

/** 通知先のチャンネルが未設定、または Slack 連携が無効で送れない */
export const WIKI_ANNOUNCE_UNAVAILABLE = 'WIKI_ANNOUNCE_UNAVAILABLE'
/** 予約中でなくなった(送信済み・取り消し済み・見送り)通知を変えようとした */
export const WIKI_ANNOUNCE_NOT_SCHEDULED = 'WIKI_ANNOUNCE_NOT_SCHEDULED'
/** 予約の日時が刻み(15 分)に揃っていない、過去、または先すぎる */
export const WIKI_ANNOUNCE_INVALID_SCHEDULE = 'WIKI_ANNOUNCE_INVALID_SCHEDULE'
/** 1 ページの予約中の通知が上限に達した */
export const WIKI_ANNOUNCE_TOO_MANY_SCHEDULED = 'WIKI_ANNOUNCE_TOO_MANY_SCHEDULED'

/** 一覧・サイドバーのバッジに出す通知の状態 */
export const WIKI_ANNOUNCE_STATES = ['none', 'scheduled', 'sent'] as const
export type WikiAnnounceState = (typeof WIKI_ANNOUNCE_STATES)[number]

/** ページの通知の状態。予約中があればそれを優先する(次に何が起きるかを示す) */
export const wikiAnnounceStateOf = (statuses: readonly WikiAnnouncementNotifyStatus[]): WikiAnnounceState =>
  statuses.includes('scheduled') ? 'scheduled' : statuses.includes('sent') ? 'sent' : 'none'

/**
 * 通知の履歴と状態を見られるか。送る側(editor 以上)の情報なので閲覧者には出さない。
 * アーカイブ済みでも editor 以上なら過去の履歴は見られる
 */
export const canSeeWikiAnnounce = (role: WikiRole | null): boolean => hasWikiRole(role, 'editor')

/**
 * 予約の日時が受け付けられるか(刻みに揃っていて、未来で、上限より先でない)。
 * タイムゾーンの時差は 15 分の倍数なので、UTC で刻みに揃っていれば利用者のタイムゾーンでも揃う
 * (変更の画面が刻みに切り下げて出しても、保存済みの時刻がずれない)
 */
export const isValidWikiAnnounceSchedule = (scheduledAt: Date, now: Date): boolean => {
  const at = scheduledAt.getTime()
  const diff = at - now.getTime()
  return at % (WIKI_ANNOUNCE_TIME_STEP_MIN * MINUTE_MS) === 0 && diff > 0 && diff <= MAX_WIKI_ANNOUNCE_SCHEDULE_MS
}
