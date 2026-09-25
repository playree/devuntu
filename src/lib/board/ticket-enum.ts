/**
 * チケットの列挙値(ステータス / 優先度 / コメント種別)と表示ラベル
 *
 * サーバー / クライアントの双方から import する純粋な定義のみを置く。
 */

import type { TicketCommentType, TicketPriority, TicketStatus } from '@/generated/prisma/enums'
import type { LocaleItemBase } from '@/locale'

/** チケットのステータス(定義順は enum と同じ) */
export const TICKET_STATUSES = ['backlog', 'todo', 'doing', 'done'] as const satisfies readonly TicketStatus[]

/** 完了(done)以外のステータス。チケット一覧の絞り込み初期値に使う */
export const OPEN_TICKET_STATUSES = TICKET_STATUSES.filter((status) => status !== 'done')

/** チケットの優先度(高い順) */
export const TICKET_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const satisfies readonly TicketPriority[]

/**
 * ステータス / 優先度の表示ラベル(ロケールキー)。
 *
 * 画面(`components/ticket/ticket-chip.tsx`)だけでなく Slack のカードなどサーバー側でも
 * 同じラベルを出すため、'use client' の付かないここを単一ソースにする。
 */
export const TICKET_STATUS_LOCALE = {
  backlog: 'status_backlog',
  todo: 'status_todo',
  doing: 'status_doing',
  done: 'status_done',
} as const satisfies Record<TicketStatus, LocaleItemBase>

export const TICKET_PRIORITY_LOCALE = {
  urgent: 'priority_urgent',
  high: 'priority_high',
  medium: 'priority_medium',
  low: 'priority_low',
} as const satisfies Record<TicketPriority, LocaleItemBase>

export const isTicketStatus = (value: string): value is TicketStatus =>
  (TICKET_STATUSES as readonly string[]).includes(value)

/** コメントの種別。plan/report は詳細画面でデフォルト折りたたみ表示する。未指定(null)は通常コメント */
export const TICKET_COMMENT_TYPES = ['plan', 'report'] as const satisfies readonly TicketCommentType[]

export const TICKET_COMMENT_TYPE_LOCALE = {
  plan: 'comment_type_plan',
  report: 'comment_type_report',
} as const satisfies Record<TicketCommentType, LocaleItemBase>
