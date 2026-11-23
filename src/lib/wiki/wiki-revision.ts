/**
 * Wiki ページの版の書き込みと参照(サーバー専用)
 *
 * 書き込みはページの書き込みと同じトランザクションで呼ぶ。同じ人が続けて保存した分は `WIKI_REVISION_MERGE_MINUTES` 以内なら
 * 最新の版へまとめ、1ページあたり `WIKI_REVISION_MAX_PER_PAGE` を超えた古い版を消す。
 * 編集者は上限まで保存を重ねれば古い版を押し出せるが、その保存は本人の名前で版に残り追跡できるので許容する
 * (手での版の削除は owner と管理者に限る)。
 * 保持期間(`WIKI_REVISION_RETENTION_DAYS`)を過ぎた版は自動メンテナンス(`sweepWikiPageRevisions`)で消す。
 * ただし存在するページの最新の版と直近の `WIKI_REVISION_KEEP_RECENT` 版は残す。
 * 復元は `wiki-page.ts` の `restoreWikiPageRevision`。
 */

import type { Prisma } from '@/generated/prisma/client'
import type { WikiPageRevisionAction, WikiVia } from '@/generated/prisma/enums'
import { approvableAgentWhere } from '../agent/agent-approver'
import type { Actor } from '../board/board-access'
import { ticketDisplayId } from '../board/ticket-id'
import { boardVisibleWhere } from '../board/ticket-permission'
import { DAY_MS, msBefore } from '../day'
import { envu } from '../env-util'
import { errInvalidOperation } from '../error'
import { logger } from '../logger'
import { prisma, type Db } from '../prisma'
import { assertWikiSpaceAccess } from './wiki-access'
import {
  canDeleteWikiRevision,
  resolveWikiRevisionTags,
  revisionTagColumns,
  revisionTagsOf,
  shouldMergeWikiRevision,
  wikiPageRef,
  type WikiPageSnapshot,
  type WikiRevisionTag,
} from './wiki-rule'
import { listWikiTags, type WikiTagOption } from './wiki-tag'
import { ancestorIds, arrangeDeletedWikiPages, indexWikiTree } from './wiki-tree'

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

/**
 * ページ内の版の新しい順。版の番号は採番で 1 ずつ増えるので、作成日時(書き込んだサーバーの時計)ではなく番号で決める。
 * 採番・一覧・ページ詳細の最新の版(`getWikiPage` の `revisionNumber`)を同じ版に揃える
 */
export const WIKI_REVISION_ORDER = { number: 'desc' } as const

/** 版を残す。まとめたときは 'merged'、新しく作ったときは 'created' */
export const writeWikiPageRevision = async (
  tx: Db,
  { snapshot: { tags, ...snapshot }, ...revision }: WriteWikiPageRevision,
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
      updatedAt: true,
    },
    orderBy: WIKI_REVISION_ORDER,
  })

  if (
    latest &&
    shouldMergeWikiRevision(
      latest,
      { action: revision.action, actorId: revision.actorId, via: revision.via, ticketId, message },
      now,
      { mergeMinutes, retentionCutoff: wikiRevisionCutoff(now) },
    )
  ) {
    await tx.wikiPageRevision.update({
      where: { id: latest.id },
      data: { ...snapshot, ...revisionTagColumns(tags), updatedAt: now },
    })
    return 'merged'
  }

  await tx.wikiPageRevision.create({
    data: {
      ...revision,
      number: (latest?.number ?? 0) + 1,
      ticketId,
      message,
      ...snapshot,
      ...revisionTagColumns(tags),
      createdAt: now,
      updatedAt: now,
    },
  })
  const excess = await tx.wikiPageRevision.findMany({
    where: { pageId: revision.pageId },
    select: { id: true },
    orderBy: WIKI_REVISION_ORDER,
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
  tagIds: true,
  tagNames: true,
  via: true,
  restoredFromId: true,
  message: true,
  createdAt: true,
  updatedAt: true,
  actor: { select: { name: true, isAgent: true } },
  ticket: { select: { id: true, number: true, board: { select: { key: true } } } },
} as const

type RevisionSummaryRow = Prisma.WikiPageRevisionGetPayload<{ select: typeof REVISION_SUMMARY_SELECT }>

export type WikiPageRevisionSummary = Omit<RevisionSummaryRow, 'actor' | 'ticket' | 'tagIds' | 'tagNames'> & {
  /** 書いたときのタグ。今のタグへは ID で引き当てる(`resolveWikiRevisionTags`) */
  tags: WikiRevisionTag[]
  actorName: string
  actorIsAgent: boolean
  /** 書いたときに対応していたチケットの表示ID。閲覧者が見られないチケットは null */
  ticketDisplayId: string | null
  /** 最後の保存が保持期限より古い(基準版、または期限を過ぎても残す最新・直近の版) */
  beforeRetention: boolean
}

/**
 * 版のチケットのうち閲覧者が見られるもの。紐づけたときは書き手が見られるかしか確かめていないので、返すたびに閲覧者で確かめる。
 * 条件は `getTicketAccess` の canView と同じ(ボードのメンバーか、担当エージェントの承認者)
 */
const viewableTicketIds = async (actor: Actor, rows: readonly Pick<RevisionSummaryRow, 'ticket'>[]) => {
  const ids = [...new Set(rows.flatMap(({ ticket }) => (ticket ? [ticket.id] : [])))]
  if (ids.length === 0) {
    return new Set<string>()
  }
  const viewable = await prisma.ticket.findMany({
    where: {
      id: { in: ids },
      OR: [{ board: boardVisibleWhere(actor.id) }, { assignee: approvableAgentWhere(actor.id) }],
    },
    select: { id: true },
  })
  return new Set(viewable.map(({ id }) => id))
}

const toRevisionSummary = (
  { actor, ticket, tagIds, tagNames, ...row }: RevisionSummaryRow,
  cutoff: Date,
  viewableTickets: ReadonlySet<string>,
): WikiPageRevisionSummary => ({
  ...row,
  tags: revisionTagsOf({ tagIds, tagNames }),
  actorName: actor?.name ?? '',
  actorIsAgent: actor?.isAgent ?? false,
  ticketDisplayId:
    ticket && viewableTickets.has(ticket.id) ? ticketDisplayId({ key: ticket.board.key, number: ticket.number }) : null,
  beforeRetention: row.updatedAt < cutoff,
})

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
  /**
   * 一覧と同じ時点のページの更新日時。画面側で、ページの表示と一覧が同じ版を指しているかの照合に使う。削除済みなら null。
   * 移動は更新日時を進めないので、照合では最新の版の番号(ページ詳細の `revisionNumber`)もあわせて比べる
   */
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
        orderBy: WIKI_REVISION_ORDER,
      }),
    ],
    { isolationLevel: 'RepeatableRead' },
  )
  const cutoff = wikiRevisionCutoff(now)
  const viewableTickets = await viewableTicketIds(actor, rows)
  return {
    revisions: rows.map((row) => toRevisionSummary(row, cutoff, viewableTickets)),
    pageUpdatedAt: page?.updatedAt ?? null,
  }
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
 * タグは版のタグのうち、いまスペースに残っているものを今の名前で返す(画面で過去の版を表示するときと同じ)
 */
export const getWikiPageRevisionSnapshot = async (
  actor: Actor,
  pageId: string,
  revisionId: string,
  now: Date = new Date(),
): Promise<Omit<WikiPageRevisionSummary, 'tags'> & { content: string; tags: WikiTagOption[] }> => {
  const row = await prisma.wikiPageRevision.findUnique({
    where: { id: revisionId },
    select: { ...REVISION_SUMMARY_SELECT, spaceId: true, content: true },
  })
  if (!row || row.pageId !== pageId) {
    throw errInvalidOperation()
  }
  const { spaceId, content, ...summary } = row
  await assertWikiSpaceAccess(actor, spaceId, 'view')
  const viewableTickets = await viewableTicketIds(actor, [summary])
  const revision = toRevisionSummary(summary, wikiRevisionCutoff(now), viewableTickets)
  return { ...revision, content, tags: resolveWikiRevisionTags(revision.tags, await listWikiTags(spaceId)) }
}

/**
 * 版を消す(`canDeleteWikiRevision`: 閲覧できる owner と管理者、未アーカイブ)。
 * 最新の版はいまの内容そのもの(削除済みのページなら復元の元)なので消せない。
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
    const access = await assertWikiSpaceAccess(actor, source.spaceId, 'manage', tx)
    if (!canDeleteWikiRevision(access)) {
      throw errInvalidOperation()
    }
    const revision = await tx.wikiPageRevision.findUnique({ where: { id: revisionId }, select: { pageId: true } })
    if (!revision) {
      return
    }
    const latest = await tx.wikiPageRevision.findFirst({
      where: { pageId: revision.pageId },
      select: { id: true },
      orderBy: WIKI_REVISION_ORDER,
    })
    if (latest?.id === revisionId) {
      throw errInvalidOperation()
    }
    await tx.wikiPageRevision.deleteMany({ where: { id: revisionId } })
  })
  logger.info({ userId: actor.id, spaceId: source.spaceId, revisionId }, 'wiki page revision deleted')
}

/** 削除済みのページの元の親 */
export type DeletedWikiPageParent =
  /** 元からスペース直下 */
  | { state: 'root' }
  /** 存在する。`path` はスペース側から元の親までのタイトル */
  | { state: 'alive'; path: string[] }
  /** 削除済み(一覧にいる)。先に戻せば子も元の位置へ戻る */
  | { state: 'deleted'; pageId: string; title: string }
  /** 存在せず一覧にも無い(復元するとスペース直下へ戻る) */
  | { state: 'missing' }

export type DeletedWikiPage = WikiPageRevisionSummary & {
  /** `KEY/番号` */
  ref: string
  /** 削除済み同士の段数(0 始まり)。一覧は親 → 子の順 */
  depth: number
  parent: DeletedWikiPageParent
}

/**
 * 削除済みのページ(いまは存在しないもの)を、最後に削除された版で返す。復元はその版から行う。
 * 上から順に復元すれば元の親子関係に戻るよう、元の親を子より先に並べる(`arrangeDeletedWikiPages`)
 */
export const listDeletedWikiPages = async (
  actor: Actor,
  spaceId: string,
  now: Date = new Date(),
): Promise<DeletedWikiPage[]> => {
  const access = await assertWikiSpaceAccess(actor, spaceId, 'view')
  const rows = await prisma.wikiPageRevision.findMany({
    where: { spaceId, action: 'deleted' },
    select: REVISION_SUMMARY_SELECT,
    // ページをまたいで並べるので、番号ではなく削除した日時の新しい順にする
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    distinct: ['pageId'],
  })
  if (rows.length === 0) {
    return []
  }
  // いま存在するページは除き、元の親のパンくずにも使う
  const alive = await prisma.wikiPage.findMany({
    where: { spaceId },
    select: { id: true, parentId: true, title: true },
  })
  const aliveIndex = indexWikiTree(alive)
  const aliveTitles = new Map(alive.map(({ id, title }) => [id, title]))
  const deleted = arrangeDeletedWikiPages(rows.filter(({ pageId }) => !aliveTitles.has(pageId)))
  const deletedTitles = new Map(deleted.map(({ pageId, title }) => [pageId, title]))
  const parentOf = ({ parentId }: { parentId: string | null }): DeletedWikiPageParent => {
    if (parentId === null) {
      return { state: 'root' }
    }
    if (aliveTitles.has(parentId)) {
      const path = [parentId, ...ancestorIds(aliveIndex, parentId)].toReversed()
      return { state: 'alive', path: path.map((id) => aliveTitles.get(id) ?? '') }
    }
    const title = deletedTitles.get(parentId)
    return title === undefined ? { state: 'missing' } : { state: 'deleted', pageId: parentId, title }
  }
  const cutoff = wikiRevisionCutoff(now)
  const viewableTickets = await viewableTicketIds(actor, deleted)
  return deleted.map(({ depth, ...row }) => ({
    ...toRevisionSummary(row, cutoff, viewableTickets),
    ref: wikiPageRef({ key: access.key, number: row.pageNumber }),
    depth,
    parent: parentOf(row),
  }))
}
