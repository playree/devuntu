/**
 * Wiki の定数と純粋関数
 *
 * サーバー / クライアントの双方から import する。DB アクセスは `wiki-access.ts` / `wiki-space.ts` / `wiki-page.ts` を参照。
 * 版の保持期間・上限・まとめる時間は環境変数から読むため、ここでは持たず引数で受け取る。
 */

import type { WikiPageRevisionAction, WikiPageType, WikiSpaceRole, WikiVia } from '@/generated/prisma/enums'
import { MAX_TAG_NAME, MAX_TICKET_TAGS } from '../board/tag-rule'
import { BOARD_KEY_PATTERN, MAX_BOARD_KEY } from '../board/ticket-id'

/** スペースキーの形式。ボードキーと同じ(大文字英字始まりの大文字英数 2〜8 字) */
export const WIKI_SPACE_KEY_PATTERN = BOARD_KEY_PATTERN
export const MAX_WIKI_SPACE_KEY = MAX_BOARD_KEY
export const MAX_WIKI_SPACE_NAME = 100
export const MAX_WIKI_SPACE_DESCRIPTION = 500

export const MAX_WIKI_TITLE = 200
/** 本文の最大長。trgm 索引と応答の大きさを抑えるため上限を設ける */
export const MAX_WIKI_CONTENT = 100_000
/** 階層の深さの上限。スペース直下のページが 1 */
export const MAX_WIKI_DEPTH = 10
/** 版に付けるコミットメッセージの最大長 */
export const MAX_WIKI_REVISION_MESSAGE = 200
/** 1ページに付けられるタグ数(チケットと同じ) */
export const MAX_WIKI_PAGE_TAGS = MAX_TICKET_TAGS

/** 検索結果の件数。画面は上限まで取り、上限に達したら絞り込みを促す */
export const DEFAULT_WIKI_SEARCH_LIMIT = 20
export const MAX_WIKI_SEARCH_LIMIT = 50

/** スペースキーの重複(DB の @unique 違反) */
export const DUPLICATED_WIKI_SPACE_KEY = 'DUPLICATED_WIKI_SPACE_KEY'
/** 読んだ後に他の人が更新した(expectedUpdatedAt の不一致) */
export const WIKI_PAGE_CONFLICT = 'WIKI_PAGE_CONFLICT'
/** 子を持つページを recursive 指定なしで削除しようとした */
export const WIKI_PAGE_HAS_CHILDREN = 'WIKI_PAGE_HAS_CHILDREN'
/** 階層の深さの上限を超える */
export const WIKI_PAGE_TOO_DEEP = 'WIKI_PAGE_TOO_DEEP'
/** 親に指定できないページ(自分自身・自分の子孫・別スペース・存在しない) */
export const WIKI_PAGE_INVALID_PARENT = 'WIKI_PAGE_INVALID_PARENT'
/** 直接割り当ての owner が 0 人になる変更(管理者は除く) */
export const WIKI_SPACE_NO_OWNER = 'WIKI_SPACE_NO_OWNER'

export type WikiRole = WikiSpaceRole

const ROLE_RANK: Record<WikiRole, number> = { viewer: 1, editor: 2, owner: 3 }

/** 最も強いロール。どれも無ければ null */
export const strongestWikiRole = (roles: readonly (WikiRole | null | undefined)[]): WikiRole | null =>
  roles.reduce<WikiRole | null>(
    (best, role) => (role && (!best || ROLE_RANK[role] > ROLE_RANK[best]) ? role : best),
    null,
  )

/** `role` が `need` 以上か */
export const hasWikiRole = (role: WikiRole | null, need: WikiRole): boolean =>
  role !== null && ROLE_RANK[role] >= ROLE_RANK[need]

/**
 * スペースでの実効ロール。直接割り当て・グループ・ボード経由のうち最も強いものを採る。
 * everyone のスペースでは、割り当てが無い人も viewer になる
 */
export const resolveWikiRole = (input: {
  direct: WikiRole | null
  groups: readonly WikiRole[]
  boards: readonly WikiRole[]
  everyone: boolean
}): WikiRole | null =>
  strongestWikiRole([input.direct, ...input.groups, ...input.boards, input.everyone ? 'viewer' : null])

export type WikiPermission = {
  canView: boolean
  /** ページの作成・編集・移動・削除 */
  canWrite: boolean
  /** スペースの設定(公開範囲・割り当て・アーカイブ) */
  canManage: boolean
}

/**
 * スペースの権限。アーカイブ済みは閲覧のみ(設定は変えられるので、アーカイブの解除はできる)。
 * 管理者はボードと同じく管理だけができ、割り当てが無ければ本文は読めない
 */
export const evaluateWikiAccess = (input: {
  role: WikiRole | null
  archived: boolean
  isAdmin: boolean
}): WikiPermission => ({
  canView: input.role !== null,
  canWrite: hasWikiRole(input.role, 'editor') && !input.archived,
  canManage: input.role === 'owner' || input.isAdmin,
})

/** 書き込みの経路 */
export type WikiWriter = { via: WikiVia }

/** 版として残す項目 */
export type WikiPageSnapshot = {
  parentId: string | null
  order: number
  title: string
  content: string
  type: WikiPageType
  tagNames: string[]
}

/** 版の書き込み元の情報(まとめてよいかの判定に使う) */
export type WikiRevisionOrigin = {
  action: WikiPageRevisionAction
  actorId: string | null
  via: WikiVia
  ticketId: string | null
  /** コミットメッセージ。付いた版は、その時点の内容を指すのでまとめない */
  message: string | null
}

/**
 * 新しい版を作らず、最新の版へまとめてよいか。
 * 同じ人・同じ経路・同じチケットの `updated` が、最新の版の作成から `mergeMinutes` 以内に続いたときだけまとめる。
 * 起点を最新の版の作成時刻に固定するので、編集が続いても1つの版が際限なく伸びない。
 * どちらかにコミットメッセージがあればまとめない
 */
export const shouldMergeWikiRevision = (
  latest: (WikiRevisionOrigin & { createdAt: Date }) | null,
  next: WikiRevisionOrigin,
  now: Date,
  mergeMinutes: number,
): boolean =>
  latest !== null &&
  mergeMinutes > 0 &&
  next.action === 'updated' &&
  latest.action === 'updated' &&
  latest.actorId === next.actorId &&
  latest.via === next.via &&
  latest.ticketId === next.ticketId &&
  latest.message === null &&
  next.message === null &&
  now.getTime() - latest.createdAt.getTime() <= mergeMinutes * 60_000

/**
 * 保持期間の掃除で消す版の id。`expired` は保持期限より古い版を新しい順(updatedAt, id の降順)に並べたもの。
 * - 存在するページ: 最新の版(カレント)と直近の `keepRecent` 版は期限より古くても残す。
 *   あわせて期限より古い版のうち最新の1版を基準版として残す。版は変更後の全文なので、一律に消すと
 *   しばらく編集していないページを編集した直後に編集前へ戻せなくなるため。
 *   `recentCounts` はページごとの期限内の版の数で、残す期限切れの版は `max(1, 1 + keepRecent - 期限内の版の数)`
 * - 削除済みのページ: すべて消す
 */
export const pickExpiredWikiRevisionIds = (
  expired: readonly { id: string; pageId: string }[],
  alivePageIds: ReadonlySet<string>,
  recentCounts: ReadonlyMap<string, number>,
  keepRecent: number,
): string[] => {
  const kept = new Map<string, number>()
  const ids: string[] = []
  for (const { id, pageId } of expired) {
    const keep = alivePageIds.has(pageId) ? Math.max(1, 1 + keepRecent - (recentCounts.get(pageId) ?? 0)) : 0
    const count = kept.get(pageId) ?? 0
    if (count < keep) {
      kept.set(pageId, count + 1)
    } else {
      ids.push(id)
    }
  }
  return ids
}

/** ページの指定(`KEY/番号`) */
export const wikiPageRef = ({ key, number }: { key: string; number: number }): string => `${key}/${number}`

/** ページの画面のパス */
export const wikiPagePath = ({ key, number }: { key: string; number: number }): string => `/wiki/${key}/${number}`

// キー部分は WIKI_SPACE_KEY_PATTERN を大文字小文字を問わない形にしたもの。番号は Int に収めるため 9 桁まで
const PAGE_REF_PATTERN = new RegExp(`^(${WIKI_SPACE_KEY_PATTERN.source.slice(1, -1)})/([1-9][0-9]{0,8})$`, 'i')

/** `KEY/番号` を読み取る。キーは大文字へ寄せる。形式外は null */
export const parseWikiPageRef = (raw: string): { key: string; number: number } | null => {
  const m = PAGE_REF_PATTERN.exec(raw.trim())
  return m ? { key: m[1].toUpperCase(), number: Number(m[2]) } : null
}

/** 検索画面の URL。`spaceKey` を渡すとスペース内検索、無ければ `/wiki` の横断検索 */
export const wikiSearchHref = ({ spaceKey, q, tags }: { spaceKey?: string; q?: string; tags?: readonly string[] }) => {
  const params = new URLSearchParams()
  if (q) {
    params.set('q', q)
  }
  for (const tag of tags ?? []) {
    params.append('tags', tag)
  }
  const query = params.toString()
  const path = spaceKey ? `/wiki/${spaceKey}/search` : '/wiki'
  return query ? `${path}?${query}` : path
}

/** 検索語の最大長(入力欄・URL の両方で揃える) */
export const MAX_WIKI_SEARCH_KEYWORD = 100

/**
 * URL のクエリ(`?q=` / `?tags=`)を検索の条件に読む。手で書き換えた URL でも検証で弾かれないよう、
 * 語は最大長で切り、タグは空と長すぎるものを除いて上限の数までにする
 */
export const parseWikiSearchParams = (params: {
  q?: string | string[]
  tags?: string | string[]
}): { keyword: string; tags: string[] } => ({
  keyword: ([params.q ?? []].flat()[0] ?? '').trim().slice(0, MAX_WIKI_SEARCH_KEYWORD),
  tags: [
    ...new Set(
      [params.tags ?? []]
        .flat()
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0 && tag.length <= MAX_TAG_NAME),
    ),
  ].slice(0, MAX_WIKI_PAGE_TAGS),
})
