/**
 * 設計書スペースのトップに出す設計書一覧の材料(サーバー専用)
 *
 * 一覧の列(版数・ステータスなど)は front matter から mddv の embed が取り出すので、本文は front matter だけを返す。
 */

import type { Actor } from '../board/board-access'
import { prisma } from '../prisma'
import { assertWikiSpaceAccess } from './wiki-access'
import { frontMatterBlock } from './wiki-markdown'

/** スペースの設計書(兄弟の並び順)と、それぞれの front matter(無ければ空文字) */
export const getWikiDesignDocIndex = async (actor: Actor, spaceId: string) => {
  await assertWikiSpaceAccess(actor, spaceId, 'view')
  const rows = await prisma.wikiPage.findMany({
    where: { spaceId, type: 'design_doc' },
    select: { id: true, parentId: true, number: true, title: true, content: true },
    orderBy: [{ order: 'asc' }, { number: 'asc' }],
  })
  return rows.map(({ content, ...row }) => ({ ...row, frontMatter: frontMatterBlock(content) ?? '' }))
}

export type WikiDesignDocIndexItem = Awaited<ReturnType<typeof getWikiDesignDocIndex>>[number]
