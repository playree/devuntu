/**
 * タスク管理(チケット / ボード)のドメインロジック
 *
 * ここには純粋関数のみを置く(prisma は型のみ `import type` で参照する)。
 * DB アクセスを伴う認可判定・更新処理は `board.ts` を参照。
 * サーバー / クライアントの双方から import され、`tests/lib/task.test.ts` の対象になる。
 */

import type { TagColor, TicketPriority, TicketStatus } from '@/generated/prisma/enums'
import type { TicketOrderByWithRelationInput, TicketWhereInput } from '@/generated/prisma/models'
import { utcToDateOnly } from './day'

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

/**
 * 一覧で並べ替えできる列。MultiTable に渡す columns の id と一致させる(tags は並べ替え不可)。
 * `zTicketSortColumn`(schema.ts) と `ticketListOrderBy` の単一ソース。
 */
export const TICKET_SORT_COLUMNS = ['title', 'status', 'priority', 'assigneeName', 'dueDate', 'updatedAt'] as const
export type TicketSortColumn = (typeof TICKET_SORT_COLUMNS)[number]

/** かんばん 1 ボードで返すカードの上限(レーン単位ではなくボード全体) */
export const MAX_KANBAN_CARDS = 500

/** 完了チケットをかんばんに表示し続ける日数。これを過ぎた done は盤面から落とす */
export const KANBAN_DONE_VISIBLE_DAYS = 30

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
 * HeroUI Chip は 5 色しか持たないため、実際の配色は tagColorClass で Tailwind へマップする。
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
 * 表示ID
 * -----------------------------------------------------------------------------------------------*/

/** ボードキーの最大長。BOARD_KEY_PATTERN と一致させる */
export const MAX_BOARD_KEY = 8

/**
 * ボードキー(表示IDの接頭辞)の形式。大文字英字始まりの大文字英数 2〜8 字。
 * 検索語の判定(parseTicketDisplayId)でも同じ形を使うため、変える場合は両方を揃えること。
 */
export const BOARD_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,7}$/

/** プライベートボードのキーの接頭辞。利用者は入力せず PRV<連番> で自動採番する */
export const PRIVATE_BOARD_KEY_PREFIX = 'PRV'

/**
 * システムが予約しているキーか。チームボードのキー入力(zBoardKey)から除外する。
 *
 * 予約しないと `PRV99999` のようなキーを 1 つ作られるだけで nextSequentialKey が
 * MAX_BOARD_KEY を超えて採番できなくなり、プライベートボードを未作成の全ユーザーで
 * ensurePrivateBoard が恒久的に失敗する(= /tickets と /boards が開けなくなる)。
 */
export const isReservedBoardKey = (key: string): boolean => key.toUpperCase().startsWith(PRIVATE_BOARD_KEY_PREFIX)

/** 表示ID。利用者へ見せる識別子で、URL やチャットに貼れる単一の表記 */
export const ticketDisplayId = ({ key, number }: { key: string; number: number }): string => `${key}-${number}`

/** 検索語 / URL から表示IDを読み取る。数値は Int の範囲に収めるため 9 桁までとする */
const DISPLAY_ID_PATTERN = /^([A-Za-z][A-Za-z0-9]{1,7})-(\d{1,9})$/

/** 表示IDの分解。形式外は null。キーは大文字へ寄せるので小文字で貼られても引ける */
export const parseTicketDisplayId = (raw: string): { key: string; number: number } | null => {
  const matched = DISPLAY_ID_PATTERN.exec(raw.trim())
  if (!matched) {
    return null
  }
  return { key: matched[1].toUpperCase(), number: Number(matched[2]) }
}

/** キー無しの番号指定(`12` / `#12`)。ボードを跨いで同じ番号がヒットする */
const TICKET_NUMBER_PATTERN = /^#?(\d{1,9})$/

export const parseTicketNumber = (raw: string): number | null => {
  const matched = TICKET_NUMBER_PATTERN.exec(raw.trim())
  return matched ? Number(matched[1]) : null
}

/**
 * `<prefix><連番>` 形式のキーの次の値。既存キーの最大 + 1(無ければ 1)。
 * プライベートボードのキー採番に使う(接頭辞の後ろが数字でないキーは無関係とみなす)。
 *
 * `maxLength` を超える桁になったら null を返す。BOARD_KEY_PATTERN を外れたキーで作られたボードは
 * チケットの表示IDを parseTicketDisplayId で解決できなくなるため、採番せず呼び出し側で失敗させる。
 */
export const nextSequentialKey = (prefix: string, keys: string[], maxLength: number = MAX_BOARD_KEY): string | null => {
  const max = keys.reduce((max, key) => {
    const rest = key.startsWith(prefix) ? key.slice(prefix.length) : ''
    if (!/^\d+$/.test(rest)) {
      return max
    }
    const seq = Number(rest)
    return seq > max ? seq : max
  }, 0)

  const key = `${prefix}${max + 1}`
  return key.length > maxLength ? null : key
}

/* -------------------------------------------------------------------------------------------------
 * 検索
 * -----------------------------------------------------------------------------------------------*/

/** 未割り当てを表す assignee の値。チケット一覧・かんばんの絞り込みで共通に使う */
export const ASSIGNEE_NONE = 'none'

/** 検索条件。`scTicketSearch`(schema.ts) の出力型と構造的に一致させる */
export type TicketSearchParams = {
  keyword: string
  status: TicketStatus[]
  priority: TicketPriority[]
  tags: string[]
  /** null / undefined = 可視ボード全体。指定時は可視ボードとの交差を取る */
  boardId?: string | null
  /** null / undefined = すべて / 'none' = 未割り当て / それ以外は userId */
  assignee?: string | null
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

/**
 * 1語ぶんの横断 OR 条件(表示ID / タイトル / 本文 / タグ / コメント)。
 *
 * 表示ID(`DEV-12`)と番号(`#12`)は完全一致で足し、貼り付けた表示IDがそのまま 1 件に絞れるようにする。
 * 表示IDそのものはどの列にも保持していないので、キーと番号へ分解して条件にする。
 */
const keywordOr = (word: string): TicketWhereInput => {
  const displayId = parseTicketDisplayId(word)
  const number = displayId ? null : parseTicketNumber(word)

  return {
    OR: [
      ...(displayId ? [{ number: displayId.number, board: { key: displayId.key } }] : []),
      ...(number === null ? [] : [{ number }]),
      { title: { contains: word, mode: 'insensitive' as const } },
      { content: { contains: word, mode: 'insensitive' as const } },
      { tags: { some: { tag: { name: { equals: word, mode: 'insensitive' as const } } } } },
      { comments: { some: { content: { contains: word, mode: 'insensitive' as const } } } },
    ],
  }
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

/* -------------------------------------------------------------------------------------------------
 * メンション
 * -----------------------------------------------------------------------------------------------*/

/** メンションに書けるメールアドレスの最大長(RFC 5321 の上限) */
export const MENTION_EMAIL_MAX = 254

/** 候補として一度に出す最大件数 */
export const MENTION_CANDIDATE_LIMIT = 8

/**
 * メンション記法 `@[foo@example.com]`
 *
 * 角括弧の中はメールアドレスに見える形(`@` と `.` を含み、空白と角括弧を含まない)だけを受け付ける。
 * 直前が単語文字 / `@` の場合はメールアドレスの一部を拾ったものとみなして無視する。
 *
 * `@\[...]` も拾うのは、エディタを通さず素のテキストとして書かれた場合の保険。
 * Markdown の書き出しでは `[` がエスケープされるため、その形が本文へ入りうる
 * (エディタから挿入したメンションは {@link formatMentionSource} が直接書き出すのでエスケープされない)。
 */
const RE_MENTION = /(?<![\w@])@\\?\[([^\s[\]@]+@[^\s[\]@]+\.[^\s[\]@]+)]/g

/**
 * Markdown のコードブロック / インラインコードを除去する(メンションの対象外にする)
 *
 * 開始と終了のバッククォート数を後方参照で揃えるため、``` ``@[foo@example.com]`` `` のように
 * バッククォートを重ねた記法でも中身を取りこぼさない。フェンスを先に落とすのは、
 * インラインの規則(改行を含まない)ではフェンス内の複数行を扱えないため。
 * 4 スペースインデントのコードブロックはリストの継続行と区別できないので対象外とする。
 */
export const stripCodeSpans = (markdown: string): string =>
  markdown.replace(/(```+|~~~+)[\s\S]*?\1/g, ' ').replace(/(`+)[^\n]*?\1/g, ' ')

/** メンションの突き合わせ用の正規化(全角/半角・大文字小文字の差異を吸収する) */
export const normalizeMentionText = (text: string): string => text.normalize('NFKC').trim().toLowerCase()

/** 本文中で見つけたメンション。表示用のノードへ差し替えるために位置も返す */
export type MentionMatch = {
  /** 正規化済みのメールアドレス */
  email: string
  /** `@` の位置 */
  index: number
  /** 記法全体の長さ */
  length: number
}

/** テキストからメンション記法を出現順に拾う。抽出と表示用ノードへの差し替えで共有する */
export const findMentions = (text: string): MentionMatch[] => {
  const matches: MentionMatch[] = []

  for (const match of text.matchAll(RE_MENTION)) {
    const email = normalizeMentionText(match[1])
    if (email.length > MENTION_EMAIL_MAX) {
      continue
    }
    matches.push({ email, index: match.index, length: match[0].length })
  }

  return matches
}

/** 本文からメンション対象のメールアドレスを出現順・重複なしで抽出する */
export const extractMentionEmails = (content: string): string[] => [
  ...new Set(findMentions(stripCodeSpans(content)).map(({ email }) => email)),
]

/**
 * メールアドレスを userId へ解決する。
 * candidates には「そのチケットにアクセスできるユーザー」のみを渡すこと。
 */
export const resolveMentionUserIds = (emails: string[], candidates: { id: string; email: string }[]): string[] => {
  const idByEmail = new Map(candidates.map(({ id, email }) => [normalizeMentionText(email), id]))

  const resolved: string[] = []
  const seen = new Set<string>()
  for (const email of emails) {
    const id = idByEmail.get(normalizeMentionText(email))
    if (id && !seen.has(id)) {
      seen.add(id)
      resolved.push(id)
    }
  }

  return resolved
}

/* -------------------------------------------------------------------------------------------------
 * メンションの入力補助
 * -----------------------------------------------------------------------------------------------*/

/**
 * キャレット直前の `@クエリ` を捉える。{@link RE_MENTION} と同じ前置ルール
 * (直前が単語文字 / `@` でない)にすることで、本文中のメールアドレスでは発火しないようにする。
 * クエリ 0 文字( `@` を打った直後)でも一致させて、その時点で一覧を出せるようにする。
 *
 * クエリに使えない文字は空白と角括弧だけ。選択結果は記法ではなくノードとして挿入されるため、
 * クエリがそのまま本文へ残ることはなく、`.` や `@` を含むメールアドレスでも絞り込める。
 */
const RE_MENTION_TRIGGER = new RegExp(`(^|[^\\w@])(@(?!@)([^\\s[\\]]{0,${MENTION_EMAIL_MAX}}))$`)

/** メンション候補の最小形。`{@link filterMentionCandidates}` は余分な項目を保ったまま絞り込む */
export type MentionCandidateLike = {
  name: string
  email: string
}

/** 入力補助が見つけたメンション。Lexical の typeahead が要求する形に合わせている */
export type MentionTriggerMatch = {
  /** `@` の位置(渡したテキストの先頭からのオフセット) */
  leadOffset: number
  /** `@` に続くクエリ */
  matchingString: string
  /** 候補を選んだときに置き換える範囲(`@` を含む) */
  replaceableString: string
}

/** キャレットまでのテキストから入力中のメンションを取り出す。無ければ null */
export const matchMentionTrigger = (textBeforeCaret: string): MentionTriggerMatch | null => {
  const match = RE_MENTION_TRIGGER.exec(textBeforeCaret)
  if (!match) {
    return null
  }
  return {
    leadOffset: match.index + match[1].length,
    matchingString: match[3],
    replaceableString: match[2],
  }
}

/** メンションを本文へ書き出す形にする。Markdown のエスケープを通さずそのまま出す前提 */
export const formatMentionSource = (email: string): string => `@[${normalizeMentionText(email)}]`

/**
 * 入力中のクエリで候補を絞り込む。担当者の ComboBox と同じ部分一致にしつつ、
 * 名前の前方一致・メールアドレスの前方一致・部分一致の順に寄せる。
 * クエリが空(`@` の直後)なら先頭から `limit` 件。
 */
export const filterMentionCandidates = <T extends MentionCandidateLike>(
  candidates: T[],
  query: string,
  limit: number = MENTION_CANDIDATE_LIMIT,
): T[] => {
  const key = normalizeMentionText(query)
  const nameMatched: T[] = []
  const emailMatched: T[] = []
  const partialMatched: T[] = []

  for (const candidate of candidates) {
    const name = normalizeMentionText(candidate.name)
    const email = normalizeMentionText(candidate.email)
    if (!key || name.startsWith(key)) {
      nameMatched.push(candidate)
    } else if (email.startsWith(key)) {
      emailMatched.push(candidate)
    } else if (name.includes(key) || email.includes(key)) {
      partialMatched.push(candidate)
    }
  }

  return [...nameMatched, ...emailMatched, ...partialMatched].slice(0, limit)
}

/* -------------------------------------------------------------------------------------------------
 * かんばんの表示対象
 * -----------------------------------------------------------------------------------------------*/

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
}

/** 絞り込みの初期値(すべて未指定) */
export const defaultKanbanFilter: KanbanFilter = { assignee: null, priority: [], tags: [], due: null }

/** 絞り込み対象のカードに最低限必要な形。LaneMap の要素型はこれを満たすこと */
export type KanbanFilterCard = KanbanCardLite & {
  assigneeId: string | null
  priority: TicketPriority
  tags: { name: string }[]
  dueDate: Date | null
}

/** 1 つでも条件が指定されているか(見出しの件数表示と絞り込みのスキップ判定に使う) */
export const isKanbanFilterActive = (filter: KanbanFilter): boolean =>
  filter.assignee !== null || filter.priority.length > 0 || filter.tags.length > 0 || filter.due !== null

/** カード 1 枚が条件に一致するか。判定は buildTicketWhere と同じセマンティクス */
export const matchesKanbanFilter = (card: KanbanFilterCard, filter: KanbanFilter): boolean => {
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
