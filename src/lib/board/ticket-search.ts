/**
 * チケット一覧の検索条件と並び順(Prisma の where / orderBy の組み立て)
 */

import type { TicketPriority, TicketStatus } from '@/generated/prisma/enums'
import type { TicketOrderByWithRelationInput, TicketWhereInput } from '@/generated/prisma/models'
import { dedupeTagNames } from './tag-rule'
import { parseTicketDisplayId, parseTicketNumber } from './ticket-id'
import type { TicketRelationFilter } from './ticket-relation-rule'

/**
 * 一覧で並べ替えできる列。MultiTable に渡す columns の id と一致させる(tags は並べ替え不可)。
 * `scTicketListQuery`(schema-ticket.ts) と `ticketListOrderBy` の単一ソース。
 */
export const TICKET_SORT_COLUMNS = ['title', 'status', 'priority', 'assigneeName', 'dueDate', 'updatedAt'] as const
export type TicketSortColumn = (typeof TICKET_SORT_COLUMNS)[number]

/** 未割り当てを表す assignee の値。チケット一覧・かんばんの絞り込みで共通に使う */
export const ASSIGNEE_NONE = 'none'

/** 検索条件。`scTicketSearch`(schema-ticket.ts) の出力型と構造的に一致させる */
export type TicketSearchParams = {
  keyword: string
  status: TicketStatus[]
  priority: TicketPriority[]
  tags: string[]
  /** null / undefined = 可視ボード全体。指定時は可視ボードとの交差を取る */
  boardId?: string | null
  /** null / undefined = すべて / 'none' = 未割り当て / それ以外は userId */
  assignee?: string | null
  /** 関係するチケットの表示ID。空文字 / undefined は絞り込まない */
  relatedTo?: string
  /** relatedTo のチケットから見た関係。未指定は all */
  relation?: TicketRelationFilter
}

/**
 * 可視チケットの where 断片。
 * プライベートチケットもプライベートボードに属するため、accessibleBoardIds へ含まれる。
 * 空配列なら 0 件になる(プライベートボードは /tickets・/boards のページ描画時に `ensurePrivateBoard` で用意する)。
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

/**
 * 表示ID / 番号(完全一致)の条件。貼り付けた表示IDがそのまま 1 件に絞れるようにする。
 * 表示IDそのものはどの列にも保持していないので、キーと番号へ分解して条件にする。
 */
const ticketIdConditions = (word: string): TicketWhereInput[] => {
  const displayId = parseTicketDisplayId(word)
  const number = displayId ? null : parseTicketNumber(word)
  return [
    ...(displayId ? [{ number: displayId.number, board: { key: displayId.key } }] : []),
    ...(number === null ? [] : [{ number }]),
  ]
}

/**
 * 1語ぶんの表示ID / 番号 / 件名の OR 条件。関係の相手の候補のように、本文やコメントまで広げると
 * 候補がぶれる場面で使う
 */
export const ticketIdOrTitleWhere = (word: string): TicketWhereInput => ({
  OR: [...ticketIdConditions(word), { title: { contains: word, mode: 'insensitive' as const } }],
})

/** 1語ぶんの横断 OR 条件(表示ID / タイトル / 本文 / タグ / コメント) */
const keywordOr = (word: string): TicketWhereInput => ({
  OR: [
    ...ticketIdConditions(word),
    { title: { contains: word, mode: 'insensitive' as const } },
    { content: { contains: word, mode: 'insensitive' as const } },
    { tags: { some: { tag: { name: { equals: word, mode: 'insensitive' as const } } } } },
    { comments: { some: { content: { contains: word, mode: 'insensitive' as const } } } },
  ],
})

/**
 * 関係するチケットの条件。child = 指定したチケットの直下の子 / related = 関連 / all = 両方。
 * 関係は同じボードの中だけなので、可視スコープの AND で他ボードは自然に落ちる。
 * 表示IDとして読めない値は 0 件にする(スキーマで弾くので通常は到達しない)
 */
export const relationWhere = (relatedTo: string, relation: TicketRelationFilter): TicketWhereInput => {
  const displayId = parseTicketDisplayId(relatedTo)
  if (!displayId) {
    return { id: { in: [] } }
  }
  const target: TicketWhereInput = { number: displayId.number, board: { key: displayId.key } }
  const child: TicketWhereInput = { relationsTo: { some: { type: 'parent', from: target } } }
  const related: TicketWhereInput = {
    OR: [
      { relationsFrom: { some: { type: 'related', to: target } } },
      { relationsTo: { some: { type: 'related', from: target } } },
    ],
  }
  if (relation === 'child') {
    return child
  }
  if (relation === 'related') {
    return related
  }
  return { OR: [child, related] }
}

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
  ctx: { accessibleBoardIds: string[] },
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
  if (params.assignee === ASSIGNEE_NONE) {
    and.push({ assigneeId: null })
  } else if (params.assignee) {
    and.push({ assigneeId: params.assignee })
  }
  if (params.relatedTo) {
    and.push(relationWhere(params.relatedTo, params.relation ?? 'all'))
  }

  return { AND: and }
}

/**
 * 一覧の並び順を Prisma の orderBy へ変換する。
 *
 * status / priority は enum の宣言順(backlog→done / urgent→low)で並ぶため、
 * クライアント側の文字列比較(アルファベット順)より意味のある順序になる。
 * ページをまたいで行が重複・欠落しないよう、最後のタイブレークに必ず id を入れる。
 */
export const ticketListOrderBy = (
  column: TicketSortColumn,
  direction: 'ascending' | 'descending',
): TicketOrderByWithRelationInput[] => {
  const sort = direction === 'ascending' ? 'asc' : 'desc'

  switch (column) {
    case 'assigneeName':
      // 担当者未設定(assigneeId が null)の行の位置は PostgreSQL の既定に任せる。
      // User.name は必須なので Prisma の nulls オプションは使えない
      return [{ assignee: { name: sort } }, { id: sort }]
    case 'dueDate':
      // 期限順に見たいのに未設定が先に来ると邪魔なので、昇順・降順とも末尾へ寄せる
      return [{ dueDate: { sort, nulls: 'last' } }, { id: sort }]
    default:
      return [{ [column]: sort }, { id: sort }]
  }
}
