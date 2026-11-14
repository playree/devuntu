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
import { logger } from '../logger'
import { prisma, type Db } from '../prisma'
import { assertWikiSpaceAccess } from './wiki-access'
import { resolveWikiTagNames, shouldMergeWikiRevision, wikiPageRef, type WikiPageSnapshot } from './wiki-rule'
import { listWikiTags, type WikiTagOption } from './wiki-tag'

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
  /** コミットメッセージ(正規化済み。空は null) */
  message?: string | null
}

/** 版を残す。まとめたときは 'merged'、新しく作ったときは 'created' */
export const writeWikiPageRevision = async (
  tx: Db,
  { snapshot, ...revision }: WriteWikiPageRevision,
  now: Date = new Date(),
): Promise<'created' | 'merged'> => {
  const ticketId = revision.ticketId ?? null
  const message = revision.message ?? null
  const mergeMinutes = envu.server.WIKI_REVISION_MERGE_MINUTES
  // 版の番号を続けるため、まとめない操作でも最新の版を引く
  const latest = await tx.wikiPageRevision.findFirst({
    where: { pageId: revision.pageId },
    select: {
      id: true,
      number: true,
      action: true,
      actorId: true,
      via: true,
      ticketId: true,
      message: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })

  if (
    latest &&
    shouldMergeWikiRevision(
      latest,
      { action: revision.action, actorId: revision.actorId, via: revision.via, ticketId, message },
      now,
      mergeMinutes,
    )
  ) {
    await tx.wikiPageRevision.update({ where: { id: latest.id }, data: { ...snapshot, updatedAt: now } })
    return 'merged'
  }

  await tx.wikiPageRevision.create({
    data: {
      ...revision,
      number: (latest?.number ?? 0) + 1,
      ticketId,
      message,
      ...snapshot,
      createdAt: now,
      updatedAt: now,
    },
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
  type: true,
  tagNames: true,
  via: true,
  restoredFromId: true,
  message: true,
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

export type WikiPageRevisionList = {
  /** 新しい順、本文なし */
  revisions: WikiPageRevisionSummary[]
  /** 一覧と同じ時点のページの更新日時。画面側で、ページの表示と一覧が同じ版を指しているかの照合に使う。削除済みなら null */
  pageUpdatedAt: Date | null
}

/** ページの版の一覧。削除済みのページの版も引ける */
export const listWikiPageRevisions = async (
  actor: Actor,
  pageId: string,
  now: Date = new Date(),
): Promise<WikiPageRevisionList> => {
  await assertWikiSpaceAccess(actor, await spaceIdOfPage(pageId), 'view')
  // ページと版は同じトランザクションで書くので、同じスナップショットで読めば最新の版とページの更新日時がそろう
  const [page, rows] = await prisma.$transaction(
    [
      prisma.wikiPage.findUnique({ where: { id: pageId }, select: { updatedAt: true } }),
      prisma.wikiPageRevision.findMany({
        where: { pageId },
        select: REVISION_SUMMARY_SELECT,
        orderBy: [...REVISION_ORDER],
      }),
    ],
    { isolationLevel: 'RepeatableRead' },
  )
  const cutoff = wikiRevisionCutoff(now)
  return { revisions: rows.map((row) => toRevisionSummary(row, cutoff)), pageUpdatedAt: page?.updatedAt ?? null }
}

/** 版の本文(版を選んで表示するときに引く) */
export const getWikiPageRevisionContent = async (actor: Actor, revisionId: string): Promise<string> => {
  const revision = await prisma.wikiPageRevision.findUnique({
    where: { id: revisionId },
    select: { spaceId: true, content: true },
  })
  if (!revision) {
    throw errInvalidOperation()
  }
  await assertWikiSpaceAccess(actor, revision.spaceId, 'view')
  return revision.content
}

/**
 * 版の内容(印刷用ページで過去の版を出すときに引く)。指定したページの版でなければ拒否する。
 * タグは版のタグ名のうち、いまスペースに残っているものを返す(画面で過去の版を表示するときと同じ)
 */
export const getWikiPageRevisionSnapshot = async (
  actor: Actor,
  pageId: string,
  revisionId: string,
  now: Date = new Date(),
): Promise<WikiPageRevisionSummary & { content: string; tags: WikiTagOption[] }> => {
  const row = await prisma.wikiPageRevision.findUnique({
    where: { id: revisionId },
    select: { ...REVISION_SUMMARY_SELECT, spaceId: true, content: true },
  })
  if (!row || row.pageId !== pageId) {
    throw errInvalidOperation()
  }
  const { spaceId, content, ...summary } = row
  await assertWikiSpaceAccess(actor, spaceId, 'view')
  const tags = resolveWikiTagNames(summary.tagNames, await listWikiTags(spaceId))
  return { ...toRevisionSummary(summary, wikiRevisionCutoff(now)), content, tags }
}

/**
 * 版を消す(編集者以上)。最新の版はいまの内容そのもの(削除済みのページなら復元の元)なので消せない。
 * 掃除や上限で先に消えていれば何もしない
 */
export const deleteWikiPageRevision = async (actor: Actor, revisionId: string): Promise<void> => {
  const source = await prisma.wikiPageRevision.findUnique({ where: { id: revisionId }, select: { spaceId: true } })
  if (!source) {
    throw errInvalidOperation()
  }
  await prisma.$transaction(async (tx) => {
    // 本文の更新と同じロック。アーカイブとは直列にする
    await tx.$queryRaw`SELECT "id" FROM "wiki_space" WHERE "id" = ${source.spaceId} FOR SHARE`
    await assertWikiSpaceAccess(actor, source.spaceId, 'write', tx)
    const revision = await tx.wikiPageRevision.findUnique({ where: { id: revisionId }, select: { pageId: true } })
    if (!revision) {
      return
    }
    const latest = await tx.wikiPageRevision.findFirst({
      where: { pageId: revision.pageId },
      select: { id: true },
      orderBy: [...REVISION_ORDER],
    })
    if (latest?.id === revisionId) {
      throw errInvalidOperation()
    }
    await tx.wikiPageRevision.deleteMany({ where: { id: revisionId } })
  })
  logger.info({ userId: actor.id, spaceId: source.spaceId, revisionId }, 'wiki page revision deleted')
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
