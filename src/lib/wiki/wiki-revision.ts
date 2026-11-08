/**
 * Wiki ページの版の書き込み(サーバー専用)
 *
 * ページの書き込みと同じトランザクションで呼ぶ。同じ人が続けて保存した分は `WIKI_REVISION_MERGE_MINUTES` 以内なら
 * 最新の版へまとめ、1ページあたり `WIKI_REVISION_MAX_PER_PAGE` を超えた古い版を消す。
 * 保持期間(`WIKI_REVISION_RETENTION_DAYS`)を過ぎた版の掃除と、一覧・差分・復元は別チケットで扱う。
 */

import type { WikiPageRevisionAction, WikiVia } from '@/generated/prisma/enums'
import { envu } from '../env-util'
import type { Db } from '../prisma'
import { shouldMergeWikiRevision, type WikiPageSnapshot } from './wiki-rule'

export type WriteWikiPageRevision = {
  spaceId: string
  pageId: string
  pageNumber: number
  action: WikiPageRevisionAction
  snapshot: WikiPageSnapshot
  actorId: string
  via: WikiVia
  ticketId?: string | null
  restoredFromId?: string | null
}

/** 版を残す。まとめたときは 'merged'、新しく作ったときは 'created' */
export const writeWikiPageRevision = async (
  tx: Db,
  { snapshot, ...revision }: WriteWikiPageRevision,
  now: Date = new Date(),
): Promise<'created' | 'merged'> => {
  const ticketId = revision.ticketId ?? null
  const mergeMinutes = envu.server.WIKI_REVISION_MERGE_MINUTES
  // まとめる対象になりうるのは updated だけなので、それ以外では最新の版を引かない
  const latest =
    revision.action === 'updated' && mergeMinutes > 0
      ? await tx.wikiPageRevision.findFirst({
          where: { pageId: revision.pageId },
          select: { id: true, action: true, actorId: true, via: true, ticketId: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        })
      : null

  if (
    latest &&
    shouldMergeWikiRevision(
      latest,
      { action: revision.action, actorId: revision.actorId, via: revision.via, ticketId },
      now,
      mergeMinutes,
    )
  ) {
    await tx.wikiPageRevision.update({ where: { id: latest.id }, data: { ...snapshot, updatedAt: now } })
    return 'merged'
  }

  await tx.wikiPageRevision.create({ data: { ...revision, ticketId, ...snapshot, createdAt: now, updatedAt: now } })
  const excess = await tx.wikiPageRevision.findMany({
    where: { pageId: revision.pageId },
    select: { id: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: envu.server.WIKI_REVISION_MAX_PER_PAGE,
  })
  if (excess.length > 0) {
    await tx.wikiPageRevision.deleteMany({ where: { id: { in: excess.map(({ id }) => id) } } })
  }
  return 'created'
}
