/**
 * かんばんの表示対象・並び替え・絞り込み
 *
 * サーバー / クライアントの双方から import する純粋関数のみを置く。
 */

import type { TicketPriority, TicketStatus } from '@/generated/prisma/enums'
import type { TicketWhereInput } from '@/generated/prisma/models'
import { nowDate, utcToDateOnly } from '../day'
import { isTicketStatus, TICKET_STATUSES } from './ticket-enum'
import { ASSIGNEE_NONE } from './ticket-search'

/**
 * かんばんのレーン表示順。todo/doing/done を横3列、その下に backlog を配置する。
 * UI とサーバーで共有する単一ソース。
 */
export const KANBAN_LANES = ['todo', 'doing', 'done', 'backlog'] as const satisfies readonly TicketStatus[]

/** かんばん 1 ボードで返すカードの上限(レーン単位ではなくボード全体) */
export const MAX_KANBAN_CARDS = 500

/** 完了チケットをかんばんに表示し続ける日数。これを過ぎた done は盤面から落とす */
export const KANBAN_DONE_VISIBLE_DAYS = 30

/**
 * 完了カードの表示期間として絞り込みで選べる日数。Select の選択肢と Cookie 値の検証で共有する。
 * 最大は KANBAN_DONE_VISIBLE_DAYS(サーバーがそれより古い done を返さないので、それ以上は増やせない)
 */
export const KANBAN_DONE_DAYS_OPTIONS = [1, 3, 7, 14, 30]

/** 完了チケットの表示期限。かんばんに出すのは `since` 以降に完了したものだけ */
export const kanbanDoneSince = (now: Date, days: number = KANBAN_DONE_VISIBLE_DAYS): Date =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

/**
 * 盤面に残す done の条件。
 * completedAt を持たない done(この機能の導入前に完了したチケット)は従来どおり表示し続ける。
 */
const doneVisibleWhere = (since: Date): TicketWhereInput => ({
  OR: [{ completedAt: null }, { completedAt: { gte: since } }],
})

/** ボード 1 枚ぶんの表示対象(盤面の取得に使う) */
export const kanbanTicketWhere = (boardId: string, since: Date): TicketWhereInput => ({
  boardId,
  OR: [{ status: { not: 'done' } }, doneVisibleWhere(since)],
})

/** レーン 1 本(boardId + status)の表示対象。done 以外は表示期限による絞り込みが要らない */
export const kanbanLaneWhere = (boardId: string, status: TicketStatus, since: Date): TicketWhereInput => ({
  boardId,
  status,
  ...(status === 'done' ? doneVisibleWhere(since) : {}),
})

/* -------------------------------------------------------------------------------------------------
 * かんばんの並び替え
 * -----------------------------------------------------------------------------------------------*/

export type KanbanCardLite = { id: string; status: TicketStatus }
export type LaneMap<T extends KanbanCardLite = KanbanCardLite> = Record<TicketStatus, T[]>

export type DropTarget = { kind: 'lane'; status: TicketStatus } | { kind: 'card'; ticketId: string }

/** 空の LaneMap。サーバーのグルーピングとクライアントの初期値で共有する */
export const emptyLaneMap = <T extends KanbanCardLite>(): LaneMap<T> =>
  Object.fromEntries(TICKET_STATUSES.map((status) => [status, [] as T[]])) as LaneMap<T>

/**
 * カード配列をレーン別へ振り分ける。並び順は入力順をそのまま保つ
 * (呼び出し側が order / createdAt でソート済みであること)。
 */
export const groupByLane = <T extends KanbanCardLite>(cards: T[]): LaneMap<T> => {
  const lanes = emptyLaneMap<T>()
  for (const card of cards) {
    lanes[card.status].push(card)
  }
  return lanes
}

/** レーンの droppable id */
export const laneDropId = (status: TicketStatus): string => `lane:${status}`

/** カードの droppable id(draggable はチケットIDそのものを使う) */
export const cardDropId = (ticketId: string): string => `card:${ticketId}`

/** droppable id をパースする。未知の形式は null */
export const parseDropTarget = (raw: string): DropTarget | null => {
  const sep = raw.indexOf(':')
  if (sep < 0) {
    return null
  }
  const kind = raw.slice(0, sep)
  const value = raw.slice(sep + 1)
  if (!value) {
    return null
  }
  if (kind === 'lane') {
    return isTicketStatus(value) ? { kind: 'lane', status: value } : null
  }
  if (kind === 'card') {
    return { kind: 'card', ticketId: value }
  }
  return null
}

/** id 配列を 0..n-1 の連番 order へ再採番する */
export const reindexLane = (ids: string[]): { id: string; order: number }[] => ids.map((id, order) => ({ id, order }))

/** 配列の index 位置へ挿入する(範囲外はクランプ) */
export const insertAt = <T>(items: T[], item: T, index: number): T[] => {
  const pos = Math.max(0, Math.min(index, items.length))
  return [...items.slice(0, pos), item, ...items.slice(pos)]
}

const sameOrder = (a: { id: string }[], b: { id: string }[]): boolean =>
  a.length === b.length && a.every((card, i) => card.id === b[i].id)

/**
 * DnD の結果を LaneMap へ適用する。
 * レーン間移動 / 同一レーン内の並び替え / 変化なし(null) をすべて扱う。
 *
 * - レーンへのドロップ  : そのレーンの末尾へ
 * - カードへのドロップ  : そのカードの直前へ
 */
export const applyLaneMove = <T extends KanbanCardLite>(
  lanes: LaneMap<T>,
  { ticketId, target }: { ticketId: string; target: DropTarget },
): { lanes: LaneMap<T>; from: TicketStatus; status: TicketStatus; index: number } | null => {
  if (target.kind === 'card' && target.ticketId === ticketId) {
    // 自分自身へのドロップ
    return null
  }

  const from = TICKET_STATUSES.find((status) => lanes[status].some((card) => card.id === ticketId))
  const card = from ? lanes[from].find((c) => c.id === ticketId) : undefined
  if (!from || !card) {
    return null
  }

  let to: TicketStatus
  let index: number
  if (target.kind === 'lane') {
    to = target.status
    // レーンへのドロップは末尾へ(自分を除いた長さ)
    index = lanes[to].filter((c) => c.id !== ticketId).length
  } else {
    const overStatus = TICKET_STATUSES.find((status) => lanes[status].some((c) => c.id === target.ticketId))
    if (!overStatus) {
      return null
    }
    to = overStatus
    index = lanes[to].filter((c) => c.id !== ticketId).findIndex((c) => c.id === target.ticketId)
  }

  const rest = lanes[to].filter((c) => c.id !== ticketId)
  const nextTo = insertAt(rest, { ...card, status: to }, index)

  if (from === to && sameOrder(lanes[to], nextTo)) {
    // 位置が変わらないなら更新を投げない
    return null
  }

  const nextLanes: LaneMap<T> = { ...lanes }
  if (from !== to) {
    nextLanes[from] = lanes[from].filter((c) => c.id !== ticketId)
  }
  nextLanes[to] = nextTo

  return { lanes: nextLanes, from, status: to, index }
}

/* -------------------------------------------------------------------------------------------------
 * かんばんの絞り込み
 * -----------------------------------------------------------------------------------------------*/

/**
 * かんばんの絞り込み条件。
 *
 * チケット一覧と違いサーバーへは投げず、取得済みのカード(最大 MAX_KANBAN_CARDS 件)を
 * 描画直前にクライアントで絞る。サーバー再取得を挟むと楽観更新が破棄されてしまうため。
 */
export type KanbanFilter = {
  /** null = すべて / 'none' = 未割り当て / それ以外は userId */
  assignee: string | null
  priority: TicketPriority[]
  /** タグ「名」の配列(いずれか 1 つでも持てばヒット) */
  tags: string[]
  /** 期日の範囲(YYYY-MM-DD)。null = 未指定。両端とも含む */
  due: { start: string; end: string } | null
  /**
   * 完了カードを表示する「完了日時からの経過日数」。選べる値は KANBAN_DONE_DAYS_OPTIONS。
   * KANBAN_DONE_VISIBLE_DAYS はサーバーの取得上限と同じなので絞り込みなしと同義
   */
  doneDays: number
}

/** 絞り込みの初期値(すべて未指定) */
export const defaultKanbanFilter: KanbanFilter = {
  assignee: null,
  priority: [],
  tags: [],
  due: null,
  doneDays: KANBAN_DONE_VISIBLE_DAYS,
}

/** 絞り込み対象のカードに最低限必要な形。LaneMap の要素型はこれを満たすこと */
export type KanbanFilterCard = KanbanCardLite & {
  assigneeId: string | null
  priority: TicketPriority
  tags: { name: string }[]
  dueDate: Date | null
  completedAt: Date | null
}

/** 1 つでも条件が指定されているか(見出しの件数表示と絞り込みのスキップ判定に使う) */
export const isKanbanFilterActive = (filter: KanbanFilter): boolean =>
  filter.assignee !== null ||
  filter.priority.length > 0 ||
  filter.tags.length > 0 ||
  filter.due !== null ||
  filter.doneDays < KANBAN_DONE_VISIBLE_DAYS

/**
 * カード 1 枚が条件に一致するか。判定は buildTicketWhere と同じセマンティクス。
 * `now` は完了カードの表示期間の基準時刻(既定は現在時刻。テストからは明示的に渡す)
 */
export const matchesKanbanFilter = (card: KanbanFilterCard, filter: KanbanFilter, now: Date = nowDate()): boolean => {
  if (filter.assignee === ASSIGNEE_NONE) {
    if (card.assigneeId !== null) {
      return false
    }
  } else if (filter.assignee !== null && card.assigneeId !== filter.assignee) {
    return false
  }

  if (filter.priority.length > 0 && !filter.priority.includes(card.priority)) {
    return false
  }

  // タグは OR(いずれか 1 つでも持てばヒット)
  if (filter.tags.length > 0 && !card.tags.some((tag) => filter.tags.includes(tag.name))) {
    return false
  }

  if (filter.due) {
    // 保存値は UTC 0:00 の日付なので YYYY-MM-DD へ戻して比べる(この書式は辞書順 = 日付順)
    const due = utcToDateOnly(card.dueDate)
    // 期日なしはどの範囲にも入らないので除外する
    if (!due || due < filter.due.start || due > filter.due.end) {
      return false
    }
  }

  // 完了カードだけは完了日時からの経過日数で絞る。他のレーンは完了日時を持たないので対象外。
  // 完了日時なしの done(この機能の導入前に完了したもの)はサーバーの表示条件と揃えて常に残す
  if (card.status === 'done' && card.completedAt && card.completedAt < kanbanDoneSince(now, filter.doneDays)) {
    return false
  }

  return true
}

/**
 * LaneMap を条件で絞る。
 * 条件が未指定なら同一参照を返すので、呼び出し側の useMemo が無駄に再生成されない。
 */
export const filterLaneMap = <T extends KanbanFilterCard>(
  lanes: LaneMap<T>,
  filter: KanbanFilter,
  now: Date = nowDate(),
): LaneMap<T> => {
  if (!isKanbanFilterActive(filter)) {
    return lanes
  }
  return Object.fromEntries(
    TICKET_STATUSES.map((status) => [status, lanes[status].filter((card) => matchesKanbanFilter(card, filter, now))]),
  ) as LaneMap<T>
}

/** LaneMap の総件数(絞り込み後の表示件数を出すのに使う) */
export const countLaneMap = <T extends KanbanCardLite>(lanes: LaneMap<T>): number =>
  TICKET_STATUSES.reduce((total, status) => total + lanes[status].length, 0)
