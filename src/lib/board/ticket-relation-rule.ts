/**
 * チケット間の関係(親子 / 関連)の定義
 *
 * サーバー / クライアントの双方から import する純粋な定義のみを置く。
 */

import type { TicketStatus } from '@/generated/prisma/enums'
import type { LocaleItemBase } from '@/locale'
import { TICKET_STATUSES } from './ticket-enum'

/**
 * 関係を追加するときの向き(操作するチケットから見た相手の立場)。
 * parent = 相手を親にする / child = 相手を子にする / related = 相手と関連付ける
 */
export const TICKET_RELATION_KINDS = ['parent', 'child', 'related'] as const
export type TicketRelationKind = (typeof TICKET_RELATION_KINDS)[number]

export const TICKET_RELATION_KIND_LOCALE = {
  parent: 'relation_kind_parent',
  child: 'relation_kind_child',
  related: 'relation_kind_related',
} as const satisfies Record<TicketRelationKind, LocaleItemBase>

/** チケット検索の「関係するチケット」の絞り込み。child = 直下の子 / related = 関連 / all = 両方 */
export const TICKET_RELATION_FILTERS = ['child', 'related', 'all'] as const
export type TicketRelationFilter = (typeof TICKET_RELATION_FILTERS)[number]

export const TICKET_RELATION_FILTER_LOCALE = {
  child: 'relation_filter_child',
  related: 'relation_filter_related',
  all: 'relation_filter_all',
} as const satisfies Record<TicketRelationFilter, LocaleItemBase>

/** 子の順番の上限。画面の入力欄と MCP の入力で共通に使う */
export const MAX_CHILD_ORDER = 999

/** 関係の相手が見つからない(別ボード・存在しない・自分自身)。画面で入力欄のエラーとして出す */
export const RELATION_TARGET_INVALID = 'RELATION_TARGET_INVALID'

/** 既に同じ関係がある */
export const RELATION_ALREADY_EXISTS = 'RELATION_ALREADY_EXISTS'

/** 関連は向きを持たないので、ID の小さい方を from に揃えて 1 行で持つ */
export const normalizeRelatedPair = (a: string, b: string): { fromId: string; toId: string } =>
  a < b ? { fromId: a, toId: b } : { fromId: b, toId: a }

/** 子の進み具合(完了した子の数 / 子の数) */
export type ChildProgress = { done: number; total: number }

export const childProgress = (statuses: TicketStatus[]): ChildProgress => ({
  done: statuses.filter((status) => status === 'done').length,
  total: statuses.length,
})

/** 関係するチケットをチケット一覧で開くパス。完了も含めて見たいのでステータスは全部選ぶ */
export const relatedTicketListPath = (displayId: string, relation: TicketRelationFilter): string => {
  const params = new URLSearchParams({ relatedTo: displayId, relation })
  for (const status of TICKET_STATUSES) {
    params.append('status', status)
  }
  return `/tickets?${params.toString()}`
}
