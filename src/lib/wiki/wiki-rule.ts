/**
 * Wiki の定数と純粋関数
 *
 * サーバー / クライアントの双方から import する。DB アクセスは `wiki-access.ts` / `wiki-space.ts` / `wiki-page.ts` を参照。
 * 版の保持期間・上限・まとめる時間は環境変数から読むため、ここでは持たず引数で受け取る。
 */

import type { WikiPageRevisionAction, WikiSpaceRole, WikiVia } from '@/generated/prisma/enums'
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
  tagNames: string[]
}

/** 版の書き込み元の情報(まとめてよいかの判定に使う) */
export type WikiRevisionOrigin = {
  action: WikiPageRevisionAction
  actorId: string | null
  via: WikiVia
  ticketId: string | null
}

/**
 * 新しい版を作らず、最新の版へまとめてよいか。
 * 同じ人・同じ経路・同じチケットの `updated` が、最新の版の作成から `mergeMinutes` 以内に続いたときだけまとめる。
 * 起点を最新の版の作成時刻に固定するので、編集が続いても1つの版が際限なく伸びない
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
  now.getTime() - latest.createdAt.getTime() <= mergeMinutes * 60_000

/** ページの指定(`KEY/番号`) */
export const wikiPageRef = ({ key, number }: { key: string; number: number }): string => `${key}/${number}`

// キー部分は WIKI_SPACE_KEY_PATTERN を大文字小文字を問わない形にしたもの。番号は Int に収めるため 9 桁まで
const PAGE_REF_PATTERN = new RegExp(`^(${WIKI_SPACE_KEY_PATTERN.source.slice(1, -1)})/([1-9][0-9]{0,8})$`, 'i')

/** `KEY/番号` を読み取る。キーは大文字へ寄せる。形式外は null */
export const parseWikiPageRef = (raw: string): { key: string; number: number } | null => {
  const m = PAGE_REF_PATTERN.exec(raw.trim())
  return m ? { key: m[1].toUpperCase(), number: Number(m[2]) } : null
}
