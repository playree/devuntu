/**
 * Wiki の定数と純粋関数
 *
 * サーバー / クライアントの双方から import する。DB アクセスは `wiki-access.ts` / `wiki-space.ts` / `wiki-page.ts` を参照。
 * 版の保持期間・上限・まとめる時間は環境変数から読むため、ここでは持たず引数で受け取る。
 */

import type {
  WikiPageRevisionAction,
  WikiPageType,
  WikiSpaceRole,
  WikiSpaceType,
  WikiVia,
} from '@/generated/prisma/enums'
import { z } from 'zod'
import { MAX_TAG_NAME, MAX_TICKET_TAGS } from '../board/tag-rule'
import { BOARD_KEY_PATTERN, MAX_BOARD_KEY } from '../board/ticket-id'
import { isSameSet } from '../list-compare'

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
/** 画面が見ていたツリー(親・配下の件数)と、今のツリーが食い違う */
export const WIKI_TREE_CHANGED = 'WIKI_TREE_CHANGED'
/** 階層の深さの上限を超える */
export const WIKI_PAGE_TOO_DEEP = 'WIKI_PAGE_TOO_DEEP'
/** 親に指定できないページ(自分自身・自分の子孫・別スペース・存在しない) */
export const WIKI_PAGE_INVALID_PARENT = 'WIKI_PAGE_INVALID_PARENT'
/** 直接割り当ての owner が 0 人になる変更(管理者は除く) */
export const WIKI_SPACE_NO_OWNER = 'WIKI_SPACE_NO_OWNER'
/** スペースの区分で作れない種類のページ・テンプレート(設計書スペースの通常ページ、アナウンス用スペースの設計書) */
export const WIKI_PAGE_TYPE_NOT_ALLOWED = 'WIKI_PAGE_TYPE_NOT_ALLOWED'

/** アナウンス用スペースで、親の指定・位置の指定・移動・並べ替えをしようとした(ページは平らに置き、作成日時の順に並べる) */
export const WIKI_ANNOUNCEMENT_FLAT = 'WIKI_ANNOUNCEMENT_FLAT'

/**
 * 削除されていないページの条件。ページを読むクエリはすべてこれを付ける。
 * 添付の参照判定(attachment-ref / ticket-write)だけは、復元したときに添付が消えていないよう削除済みのページも数える
 */
export const WIKI_PAGE_ALIVE = { deletedAt: null } as const

export type WikiSpaceTypeSpec = {
  /** 置けるページ・テンプレートの種類。先頭が種類を指定しないときの既定 */
  pageTypes: readonly [WikiPageType, ...WikiPageType[]]
  /** ページを平らに置き、親子・並べ替えを使わない(作成日時の順に並べる) */
  flat: boolean
  /** アナウンス用(新規作成の文言・Slack への通知) */
  announce: boolean
  /** スペースのトップに出す一覧 */
  index: 'tree' | 'design_doc' | 'announcement'
  /** 種類のエラーに入れる区分の呼び名(MCP からも返すので英語) */
  label: string
}

/** スペースの区分ごとの仕様。区分による分岐はここから引く(区分は作成後に変わらない) */
export const WIKI_SPACE_TYPE_SPEC = {
  mixed: { pageTypes: ['page', 'design_doc'], flat: false, announce: false, index: 'tree', label: 'a mixed space' },
  design_doc: {
    pageTypes: ['design_doc'],
    flat: false,
    announce: false,
    index: 'design_doc',
    label: 'a design doc space',
  },
  announcement: {
    pageTypes: ['page'],
    flat: true,
    announce: true,
    index: 'announcement',
    label: 'an announcement space',
  },
} as const satisfies Record<WikiSpaceType, WikiSpaceTypeSpec>

export const wikiSpaceTypeSpec = (spaceType: WikiSpaceType): WikiSpaceTypeSpec => WIKI_SPACE_TYPE_SPEC[spaceType]

/** スペースの区分で作れるページの種類か(設計書スペースは設計書だけ、アナウンス用スペースは通常ページだけ) */
export const isWikiPageTypeAllowed = (spaceType: WikiSpaceType, pageType: WikiPageType): boolean =>
  wikiSpaceTypeSpec(spaceType).pageTypes.includes(pageType)

/** 種類を指定せずに作るページの種類 */
export const defaultWikiPageType = (spaceType: WikiSpaceType): WikiPageType => wikiSpaceTypeSpec(spaceType).pageTypes[0]

/** ページを平らに置き、親子・並べ替えを使わない区分か */
export const isFlatWikiSpace = (spaceType: WikiSpaceType): boolean => wikiSpaceTypeSpec(spaceType).flat

/** 作成・編集で種類を選べる区分か */
export const canChooseWikiPageType = (spaceType: WikiSpaceType): boolean =>
  wikiSpaceTypeSpec(spaceType).pageTypes.length > 1

const PAGE_TYPE_LABEL: Record<WikiPageType, string> = {
  page: 'normal pages (type=page)',
  design_doc: 'design docs (type=design_doc)',
}

/** 区分で作れない種類のエラー文(MCP からも返す)。`target` はページかテンプレートか */
export const wikiPageTypeRuleMessage = (spaceType: WikiSpaceType, target: 'pages' | 'templates'): string => {
  const spec = wikiSpaceTypeSpec(spaceType)
  const allowed = spec.pageTypes.map((type) => PAGE_TYPE_LABEL[type]).join(' or ')
  return `This space is ${spec.label}: its ${target} must be ${allowed}`
}

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

/**
 * 過去の版を消せるか。版はページを戻す唯一の手がかりなので、編集者ではなく owner と管理者に限る。
 * 本文を読めない管理者には消させず、アーカイブ済みは他の書き込みと同じく閉じる
 */
export const canDeleteWikiRevision = (access: WikiPermission & { archived: boolean }): boolean =>
  access.canView && access.canManage && !access.archived

/** 書き込みの経路 */
export type WikiWriter = { via: WikiVia }

/** 版に残すタグ。今のタグへは ID で引き当て、名前は削除済みのタグを差分に出すときに使う */
export type WikiRevisionTag = { id: string; name: string }

/** 保存する項目(タイトル・本文・種類・タグ)。編集中の下書きとも比べる */
export type WikiPageFields = {
  title: string
  content: string
  type: WikiPageType
  tagIds: readonly string[]
}

/** 保存する項目が変わったか。タグは並びを問わず集合で比べる */
export const isWikiPageChanged = (before: WikiPageFields, after: WikiPageFields): boolean =>
  before.title !== after.title ||
  before.content !== after.content ||
  before.type !== after.type ||
  !isSameSet(before.tagIds, after.tagIds)

/** 版として残す項目 */
export type WikiPageSnapshot = {
  parentId: string | null
  order: number
  title: string
  content: string
  type: WikiPageType
  tags: WikiRevisionTag[]
}

const scRevisionTags = z.array(z.object({ id: z.string(), name: z.string() }))

/** 版の `tags` 列(JSON)を読む。形が崩れていれば(手で書き換えた DB など)タグなしとして扱う */
export const revisionTagsOf = (json: unknown): WikiRevisionTag[] => {
  const parsed = scRevisionTags.safeParse(json)
  return parsed.success ? parsed.data : []
}

/** 版の `tags` 列(JSON)に書く値。ID と名前だけを残す */
export const revisionTagsJson = (tags: readonly WikiRevisionTag[]): WikiRevisionTag[] =>
  tags.map(({ id, name }) => ({ id, name }))

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
 * どちらかにコミットメッセージがあればまとめない。
 * 最新の版の最後の保存が保持期限(`retentionCutoff`)より前ならまとめない。版の掃除はその版を基準版として残すので、
 * まとめると保持期間より前の時点へ戻せなくなる(まとめる時間を保持期間以上にしたとき)
 */
export const shouldMergeWikiRevision = (
  latest: (WikiRevisionOrigin & { createdAt: Date; updatedAt: Date }) | null,
  next: WikiRevisionOrigin,
  now: Date,
  { mergeMinutes, retentionCutoff }: { mergeMinutes: number; retentionCutoff: Date },
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
  now.getTime() - latest.createdAt.getTime() <= mergeMinutes * 60_000 &&
  latest.updatedAt.getTime() >= retentionCutoff.getTime()

/**
 * 版のタグを、いまスペースに残っているタグに ID で引き当てる(スペースの表示順)。
 * 改名したタグは今の名前で出し、削除したタグは(同じ名前で作り直していても)出さない。復元時と同じ扱い
 */
export const resolveWikiRevisionTags = <T extends { id: string }>(
  tags: readonly WikiRevisionTag[],
  spaceTags: readonly T[],
): T[] => {
  const ids = new Set(tags.map(({ id }) => id))
  return spaceTags.filter(({ id }) => ids.has(id))
}

/**
 * 差分に出す版のタグ名。スペースに残っていれば今の名前、削除済みなら版に残る名前を `deletedLabel` で印を付けて出す
 * (削除したタグと同じ名前のタグを作り直したときに、別のタグだと分かるようにする)
 */
export const wikiRevisionTagLabels = (
  tags: readonly WikiRevisionTag[],
  spaceTags: readonly WikiRevisionTag[],
  deletedLabel: (name: string) => string,
): string[] => {
  const nameById = new Map(spaceTags.map(({ id, name }) => [id, name]))
  return tags.map(({ id, name }) => nameById.get(id) ?? deletedLabel(name))
}

/** ページの指定(`KEY/番号`) */
export const wikiPageRef = ({ key, number }: { key: string; number: number }): string => `${key}/${number}`

/** Wiki のトップ(スペースの一覧)のパス */
export const WIKI_TOP_PATH = '/wiki'

/** スペースのトップのパス */
export const wikiSpacePath = (key: string): string => `${WIKI_TOP_PATH}/${key}`

/** スペースの設定画面のパス */
export const wikiSettingsPath = (key: string): string => `${wikiSpacePath(key)}/settings`

/** ページの画面のパス */
export const wikiPagePath = ({ key, number }: { key: string; number: number }): string =>
  `${wikiSpacePath(key)}/${number}`

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
  const path = spaceKey ? `${wikiSpacePath(spaceKey)}/search` : WIKI_TOP_PATH
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
