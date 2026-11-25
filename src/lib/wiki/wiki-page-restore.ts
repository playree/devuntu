/**
 * Wiki ページの復元(版の内容へ戻す・削除済みを戻す)(サーバー専用)
 *
 * ロックの順序は wiki-lock.ts を参照。
 */

import { Prisma } from '@/generated/prisma/client'
import type { Actor } from '../board/board-access'
import { errInvalidOperation } from '../error'
import { isSameSet } from '../list-compare'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { assertWikiSpaceAccess } from './wiki-access'
import { lockWikiPages, lockWikiSpace, shareLockWikiSpace } from './wiki-lock'
import { applySiblingOrders, loadWikiTree, siblingIdsOf } from './wiki-page-tree'
import {
  assertPageTypeAllowed,
  errTooDeep,
  errTreeChanged,
  findPageSpace,
  SNAPSHOT_SELECT,
  snapshotOf,
  type WikiPageWriteResult,
} from './wiki-page-write'
import { writeWikiPageRevision } from './wiki-revision'
import {
  isFlatWikiSpace,
  isWikiPageChanged,
  MAX_WIKI_DEPTH,
  revisionTagsOf,
  WIKI_PAGE_ALIVE,
  wikiPageRef,
  type WikiWriter,
} from './wiki-rule'
import { findWikiTagsByIds, syncWikiPageTags } from './wiki-tag'
import { depthOf, descendantIds, indexWikiTree, placeInSiblings, subtreeHeight } from './wiki-tree'

/**
 * 版の内容へ戻し、restored の版を残す。対象は削除されていないページだけ(削除済みは `restoreDeletedWikiPage`)。
 * タイトル・本文・種類・タグだけを戻し、位置(親・並び)は変えない(位置は移動で変える)。
 * タグは ID で引き当て(改名したタグは今の名前で付く)、スペースから消えたタグは外す
 */
export const restoreWikiPageRevision = async (
  actor: Actor,
  writer: WikiWriter,
  revisionId: string,
): Promise<WikiPageWriteResult> => {
  const source = await prisma.wikiPageRevision.findUnique({ where: { id: revisionId }, select: { spaceId: true } })
  if (!source) {
    throw errInvalidOperation()
  }
  const spaceId = source.spaceId
  const outcome = await prisma.$transaction(async (tx) => {
    await shareLockWikiSpace(tx, spaceId)
    const access = await assertWikiSpaceAccess(actor, spaceId, 'write', tx)
    // ロックを取った後で読み直す(掃除で消えた版からは戻さない)
    const revision = await tx.wikiPageRevision.findUnique({
      where: { id: revisionId },
      select: { pageId: true, title: true, content: true, type: true, tags: true },
    })
    if (!revision) {
      throw errInvalidOperation()
    }
    assertPageTypeAllowed(access, revision.type)
    const { pageId } = revision
    await lockWikiPages(tx, [pageId])
    const existing = await tx.wikiPage.findUnique({
      where: { id: pageId, ...WIKI_PAGE_ALIVE },
      select: { ...SNAPSHOT_SELECT, number: true, updatedAt: true },
    })
    if (!existing) {
      throw errInvalidOperation()
    }
    const { number } = existing
    const ref = wikiPageRef({ key: access.key, number })
    const tags = await findWikiTagsByIds(
      tx,
      spaceId,
      revisionTagsOf(revision.tags).map(({ id }) => id),
    )
    const tagIds = tags.map(({ id }) => id)
    const currentTagIds = existing.tags.map(({ tag }) => tag.id)
    if (!isWikiPageChanged({ ...existing, tagIds: currentTagIds }, { ...revision, tagIds })) {
      return { result: 'unchanged' as const, id: pageId, ref, number, updatedAt: existing.updatedAt }
    }
    const updated = await tx.wikiPage.update({
      where: { id: pageId },
      data: {
        title: revision.title,
        content: revision.content,
        type: revision.type,
        updatedById: actor.id,
        updatedVia: writer.via,
      },
      select: { updatedAt: true },
    })
    if (!isSameSet(currentTagIds, tagIds)) {
      await syncWikiPageTags(tx, pageId, currentTagIds, tagIds)
    }
    await writeWikiPageRevision(tx, {
      spaceId,
      pageId,
      action: 'restored',
      snapshot: {
        ...snapshotOf(existing),
        title: revision.title,
        content: revision.content,
        type: revision.type,
        tags,
      },
      actorId: actor.id,
      via: writer.via,
      restoredFromId: revisionId,
    })
    return { result: 'updated' as const, id: pageId, ref, number, updatedAt: updated.updatedAt }
  })

  if (outcome.result !== 'unchanged') {
    logger.info({ userId: actor.id, revisionId, id: outcome.id, via: writer.via }, 'wiki page restored')
  }
  return outcome
}

export type RestoreDeletedWikiPageResult = {
  /** 戻した(restored)か、一覧を開いた後に別の人が戻していて戻すものが無かった(unchanged)か */
  result: 'restored' | 'unchanged'
  id: string
  /** `KEY/番号` */
  ref: string
  number: number
  /** 戻したページ数(配下を含む) */
  restored: number
}

/**
 * 削除済みのページを戻し、ページごとに restored の版を残す。作成者・作成日時・本文は削除したときのまま
 * (タグは削除中にスペースから消されたものだけが外れる)。
 * - 元の親が生きていて、戻す部分木が深さの上限に収まればその下の元の位置へ、そうでなければスペース直下の末尾へ戻す
 *   (アナウンス用スペースは平らなので常にスペース直下)
 * - `withDescendants` を指定すると、削除済みの配下(親をたどって着く削除済みのページ)も同じトランザクションで戻す。
 *   配下は親子関係を保ったまま戻る。`expectedDescendantIds` は利用者に確認した配下で、今の削除済みの配下と違えば戻さずに弾く
 * 既に戻されていれば(一覧を開いた後に別の人が戻した)そのページは上書きせず、配下だけを戻す。
 * そのページが別の人に深い位置へ移されていて、配下を戻すと深さの上限を超えるなら弾く
 */
export const restoreDeletedWikiPage = async (
  actor: Actor,
  writer: WikiWriter,
  pageId: string,
  opts: { withDescendants?: boolean; expectedDescendantIds?: readonly string[] } = {},
): Promise<RestoreDeletedWikiPageResult> => {
  const spaceId = await findPageSpace(pageId)
  const outcome = await prisma.$transaction(async (tx) => {
    // 木に差し込むので、構造を変える書き込みとして直列にする
    await lockWikiSpace(tx, spaceId)
    const access = await assertWikiSpaceAccess(actor, spaceId, 'write', tx)
    const target = await tx.wikiPage.findUnique({
      where: { id: pageId },
      select: { id: true, number: true, parentId: true, order: true, deletedAt: true },
    })
    if (!target) {
      throw errInvalidOperation()
    }
    const ref = wikiPageRef({ key: access.key, number: target.number })
    const deletedRows = opts.withDescendants
      ? await tx.wikiPage.findMany({
          where: { spaceId, deletedAt: { not: null } },
          select: { id: true, parentId: true },
        })
      : []
    const deletedIndex = indexWikiTree(deletedRows)
    const descendants = descendantIds(deletedIndex, pageId)
    if (opts.expectedDescendantIds && !isSameSet(opts.expectedDescendantIds, descendants)) {
      throw errTreeChanged()
    }
    const restoreIds = [...(target.deletedAt ? [pageId] : []), ...descendants]
    if (restoreIds.length === 0) {
      return { result: 'unchanged' as const, id: pageId, ref, number: target.number, restored: 0 }
    }
    await lockWikiPages(tx, restoreIds)

    const isFlat = isFlatWikiSpace(access.type)
    if (target.deletedAt) {
      // アナウンス用スペースは平らなので、全件の木は読まずにスペース直下へ戻す
      const rows = await loadWikiTree(tx, access)
      const index = indexWikiTree(rows)
      const height = descendants.length > 0 ? subtreeHeight(deletedIndex, pageId) : 1
      const parentId =
        !isFlat &&
        target.parentId !== null &&
        index.byId.has(target.parentId) &&
        depthOf(index, target.parentId) + height <= MAX_WIKI_DEPTH
          ? target.parentId
          : null
      const ordered = placeInSiblings(
        siblingIdsOf(rows, parentId),
        pageId,
        parentId === target.parentId ? target.order : undefined,
      )
      const order = isFlat ? 0 : ordered.indexOf(pageId)
      await applySiblingOrders(tx, rows, ordered, pageId)
      // 位置だけを戻すので、更新日時は進めない(@updatedAt を避けて SQL で書く)
      await tx.$executeRaw`
        UPDATE "wiki_page" SET "parentId" = ${parentId}, "order" = ${order} WHERE "id" = ${pageId}
      `
    } else if (!isFlat) {
      // 戻されたページの下へ配下を戻す。そのページが深い位置へ移されていれば上限を超えうる
      const index = indexWikiTree(await loadWikiTree(tx, access))
      if (depthOf(index, pageId) + subtreeHeight(deletedIndex, pageId) - 1 > MAX_WIKI_DEPTH) {
        throw errTooDeep()
      }
    }
    await tx.$executeRaw`
      UPDATE "wiki_page" SET "deletedAt" = NULL, "deletedById" = NULL WHERE "id" IN (${Prisma.join(restoreIds)})
    `
    const restored = await tx.wikiPage.findMany({
      where: { id: { in: restoreIds } },
      select: { ...SNAPSHOT_SELECT, id: true },
    })
    for (const page of restored) {
      await writeWikiPageRevision(tx, {
        spaceId,
        pageId: page.id,
        action: 'restored',
        snapshot: snapshotOf(page),
        actorId: actor.id,
        via: writer.via,
      })
    }
    return { result: 'restored' as const, id: pageId, ref, number: target.number, restored: restored.length }
  })

  if (outcome.result === 'restored') {
    logger.info(
      { userId: actor.id, id: pageId, restored: outcome.restored, via: writer.via },
      'wiki deleted page restored',
    )
  }
  return outcome
}
