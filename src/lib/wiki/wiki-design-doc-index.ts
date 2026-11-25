/**
 * 設計書スペースのトップに出す設計書一覧の材料(サーバー専用)
 *
 * 一覧の列(版数・ステータスなど)は front matter から mddv の embed が取り出すので、本文は front matter だけを返す。
 * front matter は本文の先頭にあるので DB からは先頭だけを読み、判定はアプリ側の frontMatterBlock のまま行う
 * (先頭に収まらない長い front matter の行だけ、本文全体を読み直す)。
 */

import type { Actor } from '../board/board-access'
import { prisma } from '../prisma'
import { assertWikiSpaceAccess } from './wiki-access'
import { frontMatterBlock, startsWithFrontMatter } from './wiki-markdown'

/** DB から読む本文の先頭の文字数。front matter には十分な長さ */
export const DESIGN_DOC_INDEX_HEAD = 8000

type HeadRow = { id: string; parentId: string | null; number: number; title: string; head: string; truncated: boolean }

/** 切り詰めた先頭は、途中で切れた最後の行を落としてから判定する(閉じの区切りの途中で誤って一致させない) */
const frontMatterOfHead = ({ head, truncated }: HeadRow): string | null =>
  frontMatterBlock(truncated ? head.slice(0, head.lastIndexOf('\n') + 1) : head)

/** スペースの設計書(兄弟の並び順)と、それぞれの front matter(無ければ空文字) */
export const getWikiDesignDocIndex = async (actor: Actor, spaceId: string) => {
  await assertWikiSpaceAccess(actor, spaceId, 'view')
  // octet_length は TOAST の元のサイズを見るので本文全体を展開しない。left も圧縮された値の先頭だけを展開する
  const rows = await prisma.$queryRaw<HeadRow[]>`
    SELECT "id", "parentId", "number", "title",
      left("content", ${DESIGN_DOC_INDEX_HEAD}::int) AS "head",
      octet_length("content") > octet_length(left("content", ${DESIGN_DOC_INDEX_HEAD}::int)) AS "truncated"
    FROM "wiki_page"
    WHERE "spaceId" = ${spaceId} AND "type" = 'design_doc' AND "deletedAt" IS NULL
    ORDER BY "order", "number"`

  const frontMatters = new Map(rows.map((row) => [row.id, frontMatterOfHead(row)]))
  const longIds = rows
    .filter((row) => row.truncated && frontMatters.get(row.id) === null && startsWithFrontMatter(row.head))
    .map(({ id }) => id)
  if (longIds.length > 0) {
    const full = await prisma.wikiPage.findMany({ where: { id: { in: longIds } }, select: { id: true, content: true } })
    for (const { id, content } of full) {
      frontMatters.set(id, frontMatterBlock(content))
    }
  }
  return rows.map(({ id, parentId, number, title }) => ({
    id,
    parentId,
    number,
    title,
    frontMatter: frontMatters.get(id) ?? '',
  }))
}

export type WikiDesignDocIndexItem = Awaited<ReturnType<typeof getWikiDesignDocIndex>>[number]
