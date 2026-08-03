/**
 * タスク管理(チケット / ボード)のドメインロジック
 *
 * ここには純粋関数のみを置く(prisma は型のみ `import type` で参照する)。
 * DB アクセスを伴う認可判定・更新処理は `board.ts` を参照。
 * サーバー / クライアントの双方から import され、`tests/lib/task.test.ts` の対象になる。
 */

import type { TagColor, TicketPriority, TicketStatus } from '@/generated/prisma/enums'
import type { TicketWhereInput } from '@/generated/prisma/models'

/** チケットのステータス(定義順は enum と同じ) */
export const TICKET_STATUSES = ['backlog', 'todo', 'doing', 'done'] as const satisfies readonly TicketStatus[]

/** 完了(done)以外のステータス。チケット一覧の絞り込み初期値に使う */
export const OPEN_TICKET_STATUSES = TICKET_STATUSES.filter((status) => status !== 'done')

/** チケットの優先度(高い順) */
export const TICKET_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const satisfies readonly TicketPriority[]

/**
 * かんばんのレーン表示順。todo/doing/done を横3列、その下に backlog を配置する。
 * UI とサーバーで共有する単一ソース。
 */
export const KANBAN_LANES = ['todo', 'doing', 'done', 'backlog'] as const satisfies readonly TicketStatus[]

/** 一覧で返すチケットの上限。usePagingList が全件をクライアントへ返すため上限が必要 */
export const MAX_TICKET_LIST = 300

/** かんばん 1 ボードで返すカードの上限(レーン単位ではなくボード全体) */
export const MAX_KANBAN_CARDS = 500

export const isTicketStatus = (value: string): value is TicketStatus =>
  (TICKET_STATUSES as readonly string[]).includes(value)

/* -------------------------------------------------------------------------------------------------
 * 権限
 * -----------------------------------------------------------------------------------------------*/

export type BoardRole = 'owner' | 'member'

/**
 * ボードの実効ロールを解決する。
 * - 直接メンバー(BoardMember)のロールが最優先
 * - グループ経由(BoardGroup)は常に member 相当
 * - どちらも無ければ null(アクセス不可)
 *
 * 管理者特権はここに含めない。管理者は /admin/boards で管理操作のみ可能で、
 * アサインされていないボードの中身は見えない(要件の「/boards = 自分がアサインされているボード一覧」に合わせる)。
 */
export const resolveBoardRole = (directRole: BoardRole | null, hasGroupAccess: boolean): BoardRole | null =>
  directRole ?? (hasGroupAccess ? 'member' : null)

export type TicketAccessInput = {
  userId: string
  createdById: string | null
  /** resolveBoardRole の戻り値。null ならそのボードにアクセスできない */
  boardRole: BoardRole | null
  /** 所属ボードがアーカイブ済みか。アーカイブ済みは読み取り専用にする */
  archived: boolean
}

export type TicketPermission = {
  canView: boolean
  /** タイトル/本文/タグ/優先度/期限/担当/ステータスの変更 + コメント投稿 */
  canEdit: boolean
  canDelete: boolean
}

/**
 * チケットの権限。メンバー(owner|member)は view/edit、delete は owner または作成者。
 *
 * プライベートチケットも「自分が owner のプライベートボード」に属するため、
 * ここを通るだけで従来の「本人のみ全操作可」と同じ結果になる(分岐は不要)。
 *
 * アーカイブ済みボードは閲覧だけ許し、チケットへの書き込み(編集 / 削除 / 移動 /
 * ステータス変更 / コメント)を一律で塞ぐ。ボード自体の設定変更は別経路
 * (assertBoardAccess)なので、アーカイブの解除は引き続き可能。
 */
export const evaluateTicketAccess = ({
  userId,
  createdById,
  boardRole,
  archived,
}: TicketAccessInput): TicketPermission => {
  const canView = boardRole !== null
  const canWrite = canView && !archived
  return {
    canView,
    canEdit: canWrite,
    canDelete: canWrite && (boardRole === 'owner' || createdById === userId),
  }
}

/**
 * owner が 0 人になるアサインは owner 自身には許可しない(ボードが管理不能になる)。
 * 管理者は /admin/boards から実施できる。
 *
 * `ownerIds` には操作を適用した後の owner 一覧を渡す。
 */
export const canApplyAssignments = ({ ownerIds, byAdmin }: { ownerIds: string[]; byAdmin: boolean }): boolean =>
  byAdmin || ownerIds.length > 0

/* -------------------------------------------------------------------------------------------------
 * タグ
 * -----------------------------------------------------------------------------------------------*/

/**
 * タグの表示色(定義順 = 選択UIの並び順)。Prisma の TagColor enum と一致させる。
 * HeroUI Chip は 5 色しか持たないため、実際の配色は TAG_COLOR_CLASS で Tailwind へマップする。
 */
export const TAG_COLORS = [
  'gray',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'indigo',
  'violet',
  'pink',
] as const satisfies readonly TagColor[]

/** 1 チケットに付けられるタグ数 */
export const MAX_TICKET_TAGS = 10

/** タグ名の最大長 */
export const MAX_TAG_NAME = 20

/** 1 ボードあたりのタグ数上限(選択UIが破綻しない範囲) */
export const MAX_TAGS_PER_SCOPE = 50

/**
 * プライベートボードの Board.name に入れる固定値。
 * 表示は kind==='private' のときロケール(`private`)へ差し替えるため、この値は画面に出ない。
 */
export const PRIVATE_BOARD_NAME = '__private__'

/** 表記そのままで trim + 空除去 + 重複除去(検索条件を無駄に増やさない) */
export const dedupeTagNames = (names: string[]): string[] => [
  ...new Set(names.map((name) => name.trim()).filter((name) => name.length > 0)),
]

/** 同名タグ(別ボード)を 1 件に畳む。色は最初に見つかったものを採用する */
export const dedupeTagOptionsByName = <T extends { name: string }>(tags: T[]): T[] => {
  const byName = new Map<string, T>()
  for (const tag of tags) {
    if (!byName.has(tag.name)) {
      byName.set(tag.name, tag)
    }
  }
  return [...byName.values()]
}

/** 既存 order の最大 + 1、空なら 0。タグの表示順とレーン内の並び順で共用する(詰め直しはしない) */
export const nextOrder = (existing: number[]): number => existing.reduce((max, v) => (v > max ? v : max), -1) + 1

/**
 * TicketTag の総入れ替えに必要な差分を求める(syncTicketTags の判断部分)。
 * 重複指定は畳み、変化しない tagId は触らないことで不要な DELETE/INSERT を避ける。
 */
export const diffTagIds = (current: string[], next: string[]): { toAdd: string[]; toRemove: string[] } => {
  const currentSet = new Set(current)
  const nextSet = new Set(next)
  return {
    toAdd: [...nextSet].filter((id) => !currentSet.has(id)),
    toRemove: [...currentSet].filter((id) => !nextSet.has(id)),
  }
}

/* -------------------------------------------------------------------------------------------------
 * 検索
 * -----------------------------------------------------------------------------------------------*/

/** 検索条件。`scTicketSearch`(schema.ts) の出力型と構造的に一致させる */
export type TicketSearchParams = {
  keyword: string
  status: TicketStatus[]
  priority: TicketPriority[]
  tags: string[]
  /** null / undefined = 可視ボード全体。指定時は可視ボードとの交差を取る */
  boardId?: string | null
  assignee: 'any' | 'me' | 'none'
}

/**
 * 可視チケットの where 断片。
 * プライベートチケットもプライベートボードに属するため、accessibleBoardIds へ含まれる。
 * 空配列なら 0 件になるので、呼び出し元は先に `ensurePrivateBoard` を通しておくこと。
 */
export const ticketScopeWhere = (accessibleBoardIds: string[]): TicketWhereInput => ({
  boardId: { in: accessibleBoardIds },
})

/** AND で結合するキーワードの上限 */
const MAX_KEYWORDS = 5

/**
 * キーワードを AND 結合する語に分解する。
 * Prisma の `contains` は LIKE のワイルドカードをエスケープしないため `%` `_` `\` を除去する。
 */
export const splitKeywords = (raw: string, max: number = MAX_KEYWORDS): string[] =>
  raw
    .normalize('NFKC')
    .replace(/[%_\\]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, max)

/**
 * タグ名の EXISTS 条件(いずれかのタグを持てばヒット = OR)。
 *
 * 1 つの `some` に `name: { in: [...] }` を渡すことで OR になる。
 * 条件ごとに `some` を分けて AND する(= すべてのタグを持つ)挙動ではない点に注意。
 */
export const tagNamesWhere = (names: string[]): TicketWhereInput => ({
  tags: { some: { tag: { name: { in: names } } } },
})

/** 1語ぶんの横断 OR 条件(タイトル / 本文 / タグ / コメント) */
const keywordOr = (word: string): TicketWhereInput => ({
  OR: [
    { title: { contains: word, mode: 'insensitive' } },
    { content: { contains: word, mode: 'insensitive' } },
    { tags: { some: { tag: { name: { equals: word, mode: 'insensitive' } } } } },
    { comments: { some: { content: { contains: word, mode: 'insensitive' } } } },
  ],
})

/**
 * 検索条件を Prisma の where へ変換する。
 * 可視スコープ(認可)を必ず AND の先頭に入れることで、権限チェックを where に落とし込む。
 *
 * NOTE: `contains` は ILIKE '%q%' となり索引が効かない(seq scan)。数千件までは実用上問題ないが、
 *       将来的には pg_trgm の GIN 索引か tsvector の全文検索への移行を検討する。
 *       タグ名によるボード横断の絞り込みも同様に索引が効かないが、タグ総数は数十件規模の想定。
 */
export const buildTicketWhere = (
  params: TicketSearchParams,
  ctx: { userId: string; accessibleBoardIds: string[] },
): TicketWhereInput => {
  const and: TicketWhereInput[] = []

  // 可視スコープ(認可)。boardId 指定時も可視ボードとの交差を取る(可視外の指定なら 0 件になる)
  and.push(
    ticketScopeWhere(
      params.boardId ? ctx.accessibleBoardIds.filter((id) => id === params.boardId) : ctx.accessibleBoardIds,
    ),
  )

  // キーワード(語ごとに AND、語の中はタイトル/本文/タグ/コメントの OR)
  for (const word of splitKeywords(params.keyword)) {
    and.push(keywordOr(word))
  }

  if (params.status.length > 0) {
    and.push({ status: { in: params.status } })
  }
  if (params.priority.length > 0) {
    and.push({ priority: { in: params.priority } })
  }
  // タグはいずれか 1 つでも持てばヒット(status / priority と同じく OR)
  const tagNames = dedupeTagNames(params.tags)
  if (tagNames.length > 0) {
    and.push(tagNamesWhere(tagNames))
  }
  if (params.assignee === 'me') {
    and.push({ assigneeId: ctx.userId })
  }
  if (params.assignee === 'none') {
    and.push({ assigneeId: null })
  }

  return { AND: and }
}

/* -------------------------------------------------------------------------------------------------
 * メンション
 * -----------------------------------------------------------------------------------------------*/

/** 表示名の終端とみなす区切り文字 */
const MENTION_DELIM = '\\s@,.!?:;\'"`/\\\\()\\[\\]{}<>、。．・：；！？（）「」'

/** 表示名の最大長 */
const MENTION_NAME_MAX = 60

/**
 * メンション記法
 * - `@表示名`      : 区切り文字で終端する
 * - `@[山田 太郎]` : 空白を含む名前の明示指定
 *
 * 直前が単語文字 / `@` の場合はメールアドレス等の誤検知として無視する。
 * 表示名が最大長を超える場合は終端の否定先読みにより一致しない。
 */
const RE_MENTION = new RegExp(
  '(?:^|[^\\w@])@' +
    `(?:\\[([^\\]\\n]{1,${MENTION_NAME_MAX}})\\]` +
    `|([^${MENTION_DELIM}]{1,${MENTION_NAME_MAX}})(?![^${MENTION_DELIM}]))`,
  'g',
)

/** Markdown のコードブロック / インラインコードを除去する(メンションの対象外にする) */
export const stripCodeSpans = (markdown: string): string =>
  markdown.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ')

/** 表示名の正規化(全角/半角・大文字小文字の差異を吸収する) */
export const normalizeMentionName = (name: string): string => name.normalize('NFKC').trim().toLowerCase()

/** 本文からメンション対象の表示名を出現順・重複なしで抽出する */
export const extractMentionNames = (content: string): string[] => {
  const names: string[] = []
  const seen = new Set<string>()

  for (const match of stripCodeSpans(content).matchAll(RE_MENTION)) {
    const raw = (match[1] ?? match[2] ?? '').trim()
    const key = normalizeMentionName(raw)
    if (!key || seen.has(key)) {
      continue
    }
    seen.add(key)
    names.push(raw)
  }

  return names
}

/**
 * 表示名を userId へ解決する。
 * 同名の候補が複数ある場合は誤通知を避けるため解決しない(安全側)。
 * candidates には「そのチケットにアクセスできるユーザー」のみを渡すこと。
 */
export const resolveMentionUserIds = (names: string[], candidates: { id: string; name: string }[]): string[] => {
  const idsByName = new Map<string, Set<string>>()
  for (const candidate of candidates) {
    const key = normalizeMentionName(candidate.name)
    if (!key) {
      continue
    }
    const ids = idsByName.get(key) ?? new Set<string>()
    ids.add(candidate.id)
    idsByName.set(key, ids)
  }

  const resolved: string[] = []
  const seen = new Set<string>()
  for (const name of names) {
    const ids = idsByName.get(normalizeMentionName(name))
    if (!ids || ids.size !== 1) {
      // 候補なし、または同名が複数
      continue
    }
    const [id] = ids
    if (!seen.has(id)) {
      seen.add(id)
      resolved.push(id)
    }
  }

  return resolved
}

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
): { lanes: LaneMap<T>; status: TicketStatus; index: number } | null => {
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

  return { lanes: nextLanes, status: to, index }
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
}

/** 絞り込みの初期値(すべて未指定) */
export const defaultKanbanFilter: KanbanFilter = { assignee: null, priority: [], tags: [] }

/** 未割り当てを表す assignee の値 */
export const KANBAN_ASSIGNEE_NONE = 'none'

/** 絞り込み対象のカードに最低限必要な形。LaneMap の要素型はこれを満たすこと */
export type KanbanFilterCard = KanbanCardLite & {
  assigneeId: string | null
  priority: TicketPriority
  tags: { name: string }[]
}

/** 1 つでも条件が指定されているか(見出しの件数表示と絞り込みのスキップ判定に使う) */
export const isKanbanFilterActive = (filter: KanbanFilter): boolean =>
  filter.assignee !== null || filter.priority.length > 0 || filter.tags.length > 0

/** カード 1 枚が条件に一致するか。判定は buildTicketWhere と同じセマンティクス */
export const matchesKanbanFilter = (card: KanbanFilterCard, filter: KanbanFilter): boolean => {
  if (filter.assignee === KANBAN_ASSIGNEE_NONE) {
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

  return true
}

/**
 * LaneMap を条件で絞る。
 * 条件が未指定なら同一参照を返すので、呼び出し側の useMemo が無駄に再生成されない。
 */
export const filterLaneMap = <T extends KanbanFilterCard>(lanes: LaneMap<T>, filter: KanbanFilter): LaneMap<T> => {
  if (!isKanbanFilterActive(filter)) {
    return lanes
  }
  return Object.fromEntries(
    TICKET_STATUSES.map((status) => [status, lanes[status].filter((card) => matchesKanbanFilter(card, filter))]),
  ) as LaneMap<T>
}

/** LaneMap の総件数(絞り込み後の表示件数を出すのに使う) */
export const countLaneMap = <T extends KanbanCardLite>(lanes: LaneMap<T>): number =>
  TICKET_STATUSES.reduce((total, status) => total + lanes[status].length, 0)
