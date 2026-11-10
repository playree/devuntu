/**
 * Wiki ページの版の書き込みと参照(サーバー専用)
 *
 * 書き込みはページの書き込みと同じトランザクションで呼ぶ。同じ人が続けて保存した分は `WIKI_REVISION_MERGE_MINUTES` 以内なら
 * 最新の版へまとめ、1ページあたり `WIKI_REVISION_MAX_PER_PAGE` を超えた古い版を消す。
 * 保持期間(`WIKI_REVISION_RETENTION_DAYS`)を過ぎた版は自動メンテナンス(`sweepWikiPageRevisions`)で消す。
 * ただし存在するページの最新の版と直近の `WIKI_REVISION_KEEP_RECENT` 版は残す。
 * 復元は `wiki-page.ts` の `restoreWikiPageRevision`。
 */

import type { Prisma } from '@/generated/prisma/client'
import type { WikiPageRevisionAction, WikiVia } from '@/generated/prisma/enums'
import type { Actor } from '../board/board-access'
import { ticketDisplayId } from '../board/ticket-id'
import { DAY_MS, msBefore } from '../day'
import { envu } from '../env-util'
import { errInvalidOperation } from '../error'
import { prisma, type Db } from '../prisma'
import { assertWikiSpaceAccess } from './wiki-access'
import { shouldMergeWikiRevision, wikiPageRef, type WikiPageSnapshot } from './wiki-rule'

/** 保持期限。最後の保存(updatedAt)がこれより古い版は「保持期間より前の状態」 */
export const wikiRevisionCutoff = (now: Date): Date => msBefore(now, envu.server.WIKI_REVISION_RETENTION_DAYS * DAY_MS)

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
  // 版の番号を続けるため、まとめない操作でも最新の版を引く
  const latest = await tx.wikiPageRevision.findFirst({
    where: { pageId: revision.pageId },
    select: { id: true, number: true, action: true, actorId: true, via: true, ticketId: true, createdAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })

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

  await tx.wikiPageRevision.create({
    data: { ...revision, number: (latest?.number ?? 0) + 1, ticketId, ...snapshot, createdAt: now, updatedAt: now },
  })
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

// 一覧には本文を載せない(最大長の本文 × 版数になりうるため)。本文は版を選んだときに引く
const REVISION_SUMMARY_SELECT = {
  id: true,
  pageId: true,
  pageNumber: true,
  number: true,
  action: true,
  parentId: true,
  order: true,
  title: true,
  tagNames: true,
  via: true,
  restoredFromId: true,
  createdAt: true,
  updatedAt: true,
  actor: { select: { name: true, isAgent: true } },
  ticket: { select: { number: true, board: { select: { key: true } } } },
} as const

type RevisionSummaryRow = Prisma.WikiPageRevisionGetPayload<{ select: typeof REVISION_SUMMARY_SELECT }>

export type WikiPageRevisionSummary = Omit<RevisionSummaryRow, 'actor' | 'ticket'> & {
  actorName: string
  actorIsAgent: boolean
  /** 書いたときに対応していたチケットの表示ID */
  ticketDisplayId: string | null
  /** 最後の保存が保持期限より古い(基準版、または期限を過ぎても残す最新・直近の版) */
  beforeRetention: boolean
}

const toRevisionSummary = ({ actor, ticket, ...row }: RevisionSummaryRow, cutoff: Date): WikiPageRevisionSummary => ({
  ...row,
  actorName: actor?.name ?? '',
  actorIsAgent: actor?.isAgent ?? false,
  ticketDisplayId: ticket ? ticketDisplayId({ key: ticket.board.key, number: ticket.number }) : null,
  beforeRetention: row.updatedAt < cutoff,
})

const REVISION_ORDER = [{ createdAt: 'desc' }, { id: 'desc' }] as const

/** ページのスペース。削除済みのページは版から引く */
const spaceIdOfPage = async (pageId: string): Promise<string> => {
  const owner =
    (await prisma.wikiPage.findUnique({ where: { id: pageId }, select: { spaceId: true } })) ??
    (await prisma.wikiPageRevision.findFirst({ where: { pageId }, select: { spaceId: true } }))
  if (!owner) {
    throw errInvalidOperation()
  }
  return owner.spaceId
}

/** ページの版の一覧(新しい順、本文なし)。削除済みのページの版も引ける */
export const listWikiPageRevisions = async (
  actor: Actor,
  pageId: string,
  now: Date = new Date(),
): Promise<WikiPageRevisionSummary[]> => {
  await assertWikiSpaceAccess(actor, await spaceIdOfPage(pageId), 'view')
  const rows = await prisma.wikiPageRevision.findMany({
    where: { pageId },
    select: REVISION_SUMMARY_SELECT,
    orderBy: [...REVISION_ORDER],
  })
  const cutoff = wikiRevisionCutoff(now)
  return rows.map((row) => toRevisionSummary(row, cutoff))
}

/** 版の本文と、差分の比較元になる1つ前(古い側)の版の本文 */
export const getWikiPageRevisionContents = async (
  actor: Actor,
  revisionId: string,
): Promise<{ content: string; previousContent: string | null }> => {
  const revision = await prisma.wikiPageRevision.findUnique({
    where: { id: revisionId },
    select: { spaceId: true, pageId: true, content: true, createdAt: true },
  })
  if (!revision) {
    throw errInvalidOperation()
  }
  await assertWikiSpaceAccess(actor, revision.spaceId, 'view')
  const previous = await prisma.wikiPageRevision.findFirst({
    where: {
      pageId: revision.pageId,
      OR: [{ createdAt: { lt: revision.createdAt } }, { createdAt: revision.createdAt, id: { lt: revisionId } }],
    },
    select: { content: true },
    orderBy: [...REVISION_ORDER],
  })
  return { content: revision.content, previousContent: previous?.content ?? null }
}

export type DeletedWikiPage = WikiPageRevisionSummary & {
  /** `KEY/番号` */
  ref: string
}

/** 削除済みのページ(いまは存在しないもの)を、最後に削除された版で返す。復元はその版から行う */
export const listDeletedWikiPages = async (
  actor: Actor,
  spaceId: string,
  now: Date = new Date(),
): Promise<DeletedWikiPage[]> => {
  const access = await assertWikiSpaceAccess(actor, spaceId, 'view')
  const rows = await prisma.wikiPageRevision.findMany({
    where: { spaceId, action: 'deleted' },
    select: REVISION_SUMMARY_SELECT,
    orderBy: [...REVISION_ORDER],
    distinct: ['pageId'],
  })
  if (rows.length === 0) {
    return []
  }
  const alive = await prisma.wikiPage.findMany({
    where: { id: { in: rows.map(({ pageId }) => pageId) } },
    select: { id: true },
  })
  const aliveIds = new Set(alive.map(({ id }) => id))
  const cutoff = wikiRevisionCutoff(now)
  return rows
    .filter(({ pageId }) => !aliveIds.has(pageId))
    .map((row) => ({
      ...toRevisionSummary(row, cutoff),
      ref: wikiPageRef({ key: access.key, number: row.pageNumber }),
    }))
}
