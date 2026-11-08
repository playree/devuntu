/**
 * Wiki ページの検索(サーバー専用)
 *
 * - 語は `splitKeywords`(NFKC 正規化・最大5語)で分け、すべてを満たすページを返す(AND)
 * - 1語ごとに「タイトルか本文の部分一致(ILIKE)」または「タグ名の完全一致(大文字小文字を問わない)」で当てる
 * - タイトル・本文の部分一致は pg_trgm の GIN 索引(wiki_page_title_trgm_idx / wiki_page_content_trgm_idx)で引く。
 *   トライグラムは3文字単位なので、2文字以下の語では索引が効かず全件を走査する
 * - 並び順は「すべての語がタイトルに含まれるもの」→ 更新日時の新しい順
 */

import { Prisma } from '@/generated/prisma/client'
import type { TagColor } from '@/generated/prisma/enums'
import type { Actor } from '../board/board-access'
import { dedupeTagNames } from '../board/tag-rule'
import { splitKeywords } from '../board/ticket-search'
import { prisma } from '../prisma'
import { getAccessibleWikiSpaceIds } from './wiki-access'
import { DEFAULT_WIKI_SEARCH_LIMIT, MAX_WIKI_SEARCH_LIMIT, wikiPageRef } from './wiki-rule'
import { getWikiSpaceByKey } from './wiki-space'
import { WIKI_TAG_ORDER_BY } from './wiki-tag'
import { ancestorIds, indexWikiTree } from './wiki-tree'

/** snippet の切り出し幅。一致した位置の前を SNIPPET_BEFORE 文字、全体で SNIPPET_LENGTH 文字 */
export const SNIPPET_BEFORE = 60
export const SNIPPET_LENGTH = 200

export type WikiSearchQuery = {
  /** 検索する語(分解済み)。空ならタグの絞り込みだけで探す */
  words: string[]
  /** どれかを持つページに絞るタグ名。空なら絞らない */
  tagNames: string[]
  spaceIds: string[]
  limit: number
}

const tagNameMatch = (word: string) => Prisma.sql`
  SELECT pt."pageId" FROM "wiki_page_tag" pt JOIN "wiki_tag" t ON t."id" = pt."tagId"
  WHERE lower(t."name") = lower(${word})`

/** トライグラムの長さ。これより短い語では GIN 索引が効かない */
const TRIGRAM_LENGTH = 3

/**
 * 語ごとの条件。
 * - 3文字以上: タグとの OR を EXISTS で書くと、title / content の GIN 索引を使った BitmapOr が選ばれなくなるので、
 *   ページ ID の UNION に分けて IN で受ける
 * - 2文字以下: 索引が効かず、単独で引くと全件を走査するので、他の語で絞った行への絞り込みとして書く
 *   (すべての語が短いときだけ全件の走査になる)
 */
export const wordCondition = (word: string) => {
  const pattern = `%${word}%`
  if ([...word].length >= TRIGRAM_LENGTH) {
    return Prisma.sql`p."id" IN (
  SELECT "id" FROM "wiki_page" WHERE "title" ILIKE ${pattern} OR "content" ILIKE ${pattern}
  UNION ${tagNameMatch(word)}
)`
  }
  return Prisma.sql`(p."title" ILIKE ${pattern} OR p."content" ILIKE ${pattern} OR p."id" IN (${tagNameMatch(word)}))`
}

/** 本文で最初に語が現れる位置(1 始まり)。どの語も無ければ 0 */
const firstHitPosition = (words: readonly string[]) =>
  words.length === 0
    ? Prisma.sql`0`
    : Prisma.sql`COALESCE(LEAST(${Prisma.join(
        words.map((word) => Prisma.sql`NULLIF(strpos(lower(p."content"), lower(${word})), 0)`),
      )}), 0)`

/**
 * 検索の SQL。条件に合うページを並べて `limit` 件に絞ってから、その分だけ本文の snippet を切り出す
 * (本文の全文は返さない)
 */
export const buildWikiSearchSql = ({ words, tagNames, spaceIds, limit }: WikiSearchQuery): Prisma.Sql => {
  const conditions = [
    Prisma.sql`p."spaceId" IN (${Prisma.join(spaceIds)})`,
    ...words.map(wordCondition),
    ...(tagNames.length > 0
      ? [
          Prisma.sql`p."id" IN (
            SELECT pt."pageId" FROM "wiki_page_tag" pt JOIN "wiki_tag" t ON t."id" = pt."tagId"
            WHERE t."name" IN (${Prisma.join(tagNames)})
          )`,
        ]
      : []),
  ]
  const titleMatch =
    words.length > 0
      ? Prisma.join(
          words.map((word) => Prisma.sql`p."title" ILIKE ${`%${word}%`}`),
          ' AND ',
        )
      : Prisma.sql`FALSE`

  return Prisma.sql`
    WITH hit AS (
      SELECT p."id", (${titleMatch}) AS "titleMatch", p."updatedAt"
      FROM "wiki_page" p
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY "titleMatch" DESC, p."updatedAt" DESC, p."id"
      LIMIT ${limit}
    ), pos AS (
      SELECT h.*, ${firstHitPosition(words)} AS "hitAt"
      FROM hit h JOIN "wiki_page" p ON p."id" = h."id"
    )
    SELECT p."id", p."spaceId", p."parentId", p."number", p."title", p."updatedAt",
      GREATEST(pos."hitAt" - ${SNIPPET_BEFORE}, 1)::int AS "snippetStart",
      substr(p."content", GREATEST(pos."hitAt" - ${SNIPPET_BEFORE}, 1), ${SNIPPET_LENGTH}) AS "snippet",
      length(p."content")::int AS "contentLength"
    FROM pos JOIN "wiki_page" p ON p."id" = pos."id"
    ORDER BY pos."titleMatch" DESC, pos."updatedAt" DESC, pos."id"
  `
}

type WikiSearchRow = {
  id: string
  spaceId: string
  parentId: string | null
  number: number
  title: string
  updatedAt: Date
  snippetStart: number
  snippet: string
  contentLength: number
}

/**
 * 切り出した本文を1行の抜粋にする。改行と連続する空白を1つにし、Markdown の記号を落とす。
 * 前後が切れていれば `…` を付ける
 */
export const formatWikiSnippet = ({
  snippet,
  snippetStart,
  contentLength,
}: Pick<WikiSearchRow, 'snippet' | 'snippetStart' | 'contentLength'>): string => {
  const text = snippet
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*>`|~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text === '') {
    return ''
  }
  const head = snippetStart > 1 ? '…' : ''
  const tail = snippetStart - 1 + snippet.length < contentLength ? '…' : ''
  return `${head}${text}${tail}`
}

export type WikiSearchParams = {
  keyword: string
  /** スペースキー。省略すると閲覧できる全スペース(アーカイブ済みを除く) */
  space?: string
  /** どれかを持つページに絞るタグ名 */
  tags?: string[]
  limit?: number
}

export type WikiSearchHit = {
  id: string
  /** `KEY/番号` */
  ref: string
  space: { id: string; key: string; name: string }
  number: number
  title: string
  updatedAt: Date
  tags: { id: string; name: string; color: TagColor }[]
  /** 先祖のタイトル(スペース直下から順に) */
  breadcrumbs: string[]
  snippet: string
}

/** 閲覧できるスペースの中からページを探す。語もタグも無ければ空を返す */
export const searchWikiPages = async (actor: Actor, params: WikiSearchParams): Promise<WikiSearchHit[]> => {
  const words = splitKeywords(params.keyword)
  const tagNames = dedupeTagNames(params.tags ?? [])
  if (words.length === 0 && tagNames.length === 0) {
    return []
  }
  const spaceIds = params.space
    ? [(await getWikiSpaceByKey(actor, params.space)).space.id]
    : await getAccessibleWikiSpaceIds(actor.id)
  if (spaceIds.length === 0) {
    return []
  }
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_WIKI_SEARCH_LIMIT, 1), MAX_WIKI_SEARCH_LIMIT)

  const rows = await prisma.$queryRaw<WikiSearchRow[]>(buildWikiSearchSql({ words, tagNames, spaceIds, limit }))
  if (rows.length === 0) {
    return []
  }

  const hitSpaceIds = [...new Set(rows.map(({ spaceId }) => spaceId))]
  const [spaces, trees, pageTags] = await Promise.all([
    prisma.wikiSpace.findMany({ where: { id: { in: hitSpaceIds } }, select: { id: true, key: true, name: true } }),
    prisma.wikiPage.findMany({
      where: { spaceId: { in: hitSpaceIds } },
      select: { id: true, parentId: true, title: true },
    }),
    prisma.wikiPageTag.findMany({
      where: { pageId: { in: rows.map(({ id }) => id) } },
      select: { pageId: true, tag: { select: { id: true, name: true, color: true } } },
      orderBy: WIKI_TAG_ORDER_BY.map((order) => ({ tag: order })),
    }),
  ])
  const spaceById = new Map(spaces.map((space) => [space.id, space]))
  const titleById = new Map(trees.map(({ id, title }) => [id, title]))
  const index = indexWikiTree(trees)

  return rows.flatMap((row) => {
    const space = spaceById.get(row.spaceId)
    if (!space) {
      return []
    }
    return [
      {
        id: row.id,
        ref: wikiPageRef({ key: space.key, number: row.number }),
        space,
        number: row.number,
        title: row.title,
        updatedAt: row.updatedAt,
        tags: pageTags.filter(({ pageId }) => pageId === row.id).map(({ tag }) => tag),
        breadcrumbs: ancestorIds(index, row.id)
          .reverse()
          .map((id) => titleById.get(id) ?? ''),
        snippet: formatWikiSnippet(row),
      },
    ]
  })
}
