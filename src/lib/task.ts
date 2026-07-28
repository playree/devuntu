/**
 * タスク管理(チケット / ボード)のドメインロジック
 *
 * ここには純粋関数のみを置く(prisma は型のみ `import type` で参照する)。
 * DB アクセスを伴う認可判定・更新処理は `board.ts` を参照。
 * サーバー / クライアントの双方から import され、`tests/lib/task.test.ts` の対象になる。
 */

import type { TicketPriority, TicketStatus } from '@/generated/prisma/enums'
import type { TicketWhereInput } from '@/generated/prisma/models'

/** チケットのステータス(定義順は enum と同じ) */
export const TICKET_STATUSES = ['backlog', 'todo', 'doing', 'done'] as const satisfies readonly TicketStatus[]

/** チケットの優先度(高い順) */
export const TICKET_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const satisfies readonly TicketPriority[]

/**
 * かんばんのレーン表示順。todo/doing/done を横3列、その下に backlog を配置する。
 * UI とサーバーで共有する単一ソース。
 */
export const KANBAN_LANES = ['todo', 'doing', 'done', 'backlog'] as const satisfies readonly TicketStatus[]

/** 一覧で返すチケットの上限。usePagingList が全件をクライアントへ返すため上限が必要 */
export const MAX_TICKET_LIST = 300

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

/** boardId を持たないチケットはプライベート(ownerId の所有物) */
export type TicketScope = 'private' | 'board'

export type TicketAccessInput = {
  userId: string
  boardId: string | null
  ownerId: string | null
  createdById: string | null
  /** board チケットのときのみ意味を持つ。resolveBoardRole の戻り値 */
  boardRole: BoardRole | null
}

export type TicketPermission = {
  scope: TicketScope
  canView: boolean
  /** タイトル/本文/タグ/優先度/期限/担当/ステータスの変更 + コメント投稿 */
  canEdit: boolean
  canDelete: boolean
}

/**
 * プライベート / ボードの両方を統一的に判定する単一ソース。
 * - private : 所有者本人のみ view/edit/delete
 * - board   : メンバー(owner|member)は view/edit、delete は owner または作成者
 */
export const evaluateTicketAccess = ({
  userId,
  boardId,
  ownerId,
  createdById,
  boardRole,
}: TicketAccessInput): TicketPermission => {
  if (boardId === null) {
    const isOwner = !!ownerId && ownerId === userId
    return { scope: 'private', canView: isOwner, canEdit: isOwner, canDelete: isOwner }
  }

  const canView = boardRole !== null
  return {
    scope: 'board',
    canView,
    canEdit: canView,
    canDelete: canView && (boardRole === 'owner' || createdById === userId),
  }
}

/** owner/member の多重選択を BoardMember 行へマージする(重複は owner 優先) */
export const mergeBoardMembers = (ownerIds: string[], memberIds: string[]): { userId: string; role: BoardRole }[] => {
  const roles = new Map<string, BoardRole>()
  // owner を優先させるため member を先に入れる
  for (const userId of memberIds) {
    roles.set(userId, 'member')
  }
  for (const userId of ownerIds) {
    roles.set(userId, 'owner')
  }
  return [...roles].map(([userId, role]) => ({ userId, role }))
}

/**
 * owner が 0 人になるアサインは owner 自身には許可しない(ボードが管理不能になる)。
 * 管理者は /admin/boards から実施できる。
 */
export const canApplyAssignments = ({ ownerIds, byAdmin }: { ownerIds: string[]; byAdmin: boolean }): boolean =>
  byAdmin || ownerIds.length > 0

/**
 * チケットの担当者を解決する(保存値を決める単一ソース)。
 * - プライベートチケット(boardId なし) : 常に所有者本人(自動アサイン)
 * - ボードチケット                     : 指定された担当者(未指定は null)
 *
 * クライアントの表示に依存せず、Server Action 側でこの関数を通して保存する。
 */
export const resolveTicketAssignee = ({
  boardId,
  ownerId,
  requested,
}: {
  boardId: string | null
  ownerId: string
  requested?: string | null
}): string | null => (boardId ? (requested ?? null) : ownerId)

/* -------------------------------------------------------------------------------------------------
 * 検索
 * -----------------------------------------------------------------------------------------------*/

/** 検索条件。`scTicketSearch`(schema.ts) の出力型と構造的に一致させる */
export type TicketSearchParams = {
  keyword: string
  status: TicketStatus[]
  priority: TicketPriority[]
  tags: string[]
  scope: 'all' | 'private' | 'board'
  boardId?: string | null
  assignee: 'any' | 'me' | 'none'
}

/** 可視チケットの where 断片(プライベート = 自分所有 + 参加ボード) */
export const ticketScopeWhere = (userId: string, accessibleBoardIds: string[]): TicketWhereInput => ({
  OR: [
    { boardId: null, ownerId: userId },
    ...(accessibleBoardIds.length > 0 ? [{ boardId: { in: accessibleBoardIds } }] : []),
  ],
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

/** 1語ぶんの横断 OR 条件(タイトル / 本文 / タグ / コメント) */
const keywordOr = (word: string): TicketWhereInput => ({
  OR: [
    { title: { contains: word, mode: 'insensitive' } },
    { content: { contains: word, mode: 'insensitive' } },
    { tags: { has: word } },
    { comments: { some: { content: { contains: word, mode: 'insensitive' } } } },
  ],
})

/**
 * 検索条件を Prisma の where へ変換する。
 * 可視スコープ(認可)を必ず AND の先頭に入れることで、権限チェックを where に落とし込む。
 *
 * NOTE: `contains` は ILIKE '%q%' となり索引が効かない(seq scan)。数千件までは実用上問題ないが、
 *       将来的には pg_trgm の GIN 索引か tsvector の全文検索への移行を検討する。
 */
export const buildTicketWhere = (
  params: TicketSearchParams,
  ctx: { userId: string; accessibleBoardIds: string[] },
): TicketWhereInput => {
  const and: TicketWhereInput[] = []

  // 可視スコープ(認可)
  if (params.scope === 'private') {
    and.push({ boardId: null, ownerId: ctx.userId })
  } else if (params.scope === 'board') {
    // boardId 指定時も可視ボードとの交差を取る(可視外の指定なら 0 件になる)
    const boardIds = params.boardId
      ? ctx.accessibleBoardIds.filter((id) => id === params.boardId)
      : ctx.accessibleBoardIds
    and.push({ boardId: { in: boardIds } })
  } else {
    and.push(ticketScopeWhere(ctx.userId, ctx.accessibleBoardIds))
  }

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
  if (params.tags.length > 0) {
    and.push({ tags: { hasEvery: params.tags } })
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

/** レーン末尾へ追加するときの order。空レーンは 0 */
export const nextLaneOrder = (existing: number[]): number => existing.reduce((max, v) => (v > max ? v : max), -1) + 1

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
