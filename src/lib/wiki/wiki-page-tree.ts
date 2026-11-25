/**
 * Wiki ページの木の読み込みと配置(移動・兄弟の並び)(サーバー専用)
 *
 * 純粋な木の計算は wiki-tree.ts、ロックの順序は wiki-lock.ts を参照。
 * アナウンス用スペース(`isFlatWikiSpace`)は平らで並びを持たないので、増え続ける全件の木は読まない。
 */

import { Prisma } from '@/generated/prisma/client'
import type { Actor } from '../board/board-access'
import { errInvalidOperation } from '../error'
import { isSameOrder } from '../list-compare'
import { logger } from '../logger'
import { prisma, type Db } from '../prisma'
import { assertWikiSpaceAccess, type WikiSpaceAccess } from './wiki-access'
import { lockWikiPages, lockWikiSpace } from './wiki-lock'
import {
  assertNotConflicted,
  errInvalidParent,
  errTooDeep,
  errTreeChanged,
  errWikiAnnouncementFlat,
  findPageSpace,
  parseExpectedUpdatedAt,
  resolveRevisionTicketId,
  SNAPSHOT_SELECT,
  snapshotOf,
  type ExpectOpts,
  type WikiPageWriteResult,
  type WriteOpts,
} from './wiki-page-write'
import { writeWikiPageRevision } from './wiki-revision'
import { isFlatWikiSpace, MAX_WIKI_DEPTH, WIKI_PAGE_ALIVE, wikiPageRef, type WikiWriter } from './wiki-rule'
import { depthOf, indexWikiTree, isSelfOrDescendant, placeInSiblings, subtreeHeight } from './wiki-tree'

const TREE_SELECT = { id: true, parentId: true, number: true, title: true, order: true } as const
const TREE_ORDER = [{ order: 'asc' }, { number: 'asc' }] as const

/** スペースの木(削除済みを除く、本文なし)。兄弟の並び順で返す。平らな区分は読まずに空を返す */
export const loadWikiTree = (tx: Db, space: Pick<WikiSpaceAccess, 'spaceId' | 'type'>) =>
  isFlatWikiSpace(space.type)
    ? Promise.resolve([])
    : tx.wikiPage.findMany({
        where: { spaceId: space.spaceId, ...WIKI_PAGE_ALIVE },
        select: TREE_SELECT,
        orderBy: [...TREE_ORDER],
      })

type TreeRow = { id: string; parentId: string | null; order: number }

export const siblingIdsOf = (rows: readonly TreeRow[], parentId: string | null) =>
  rows.filter((row) => row.parentId === parentId).map(({ id }) => id)

/**
 * 兄弟を `orderedIds` の並び(0 始まり)に振り直す。値が変わる行だけを 1 文で更新し、`skipId` の行は呼び出し側で書く。
 * 位置は本文の保存が上書きしない項目なので、更新日時は変えない(編集中の人の expectedUpdatedAt を競合にしないため)
 */
export const applySiblingOrders = async (
  tx: Db,
  rows: readonly TreeRow[],
  orderedIds: readonly string[],
  skipId: string,
) => {
  const orderById = new Map(rows.map(({ id, order }) => [id, order]))
  const shifted = orderedIds
    .map((id, order) => ({ id, order }))
    .filter(({ id, order }) => id !== skipId && orderById.get(id) !== order)
  if (shifted.length === 0) {
    return
  }
  await tx.$executeRaw`
    UPDATE "wiki_page" AS p
    SET "order" = v."order"
    FROM (VALUES ${Prisma.join(shifted.map(({ id, order }) => Prisma.sql`(${id}::text, ${order}::int)`))}) AS v(id, "order")
    WHERE p.id = v.id
  `
}

/** 移動先の兄弟の中の位置(自分を除いた並びでの番号)。`afterId` があればその直後で、兄弟にいなければ弾く */
const positionOf = (
  siblingIds: readonly string[],
  pageId: string,
  { position, afterId }: { position?: number; afterId?: string },
): number | undefined => {
  if (afterId === undefined) {
    return position
  }
  const at = siblingIds.filter((id) => id !== pageId).indexOf(afterId)
  if (at < 0) {
    throw errTreeChanged()
  }
  return at + 1
}

export type WikiPageMoveTarget = { parentId?: string | null; position?: number; afterId?: string }
export type WikiPageExpectedPlace = { parentId: string | null; siblingIds: readonly string[] }

/**
 * 移動の本体。スペース行を `lockWikiSpace` でロックし、書き込みの権限を確かめた後に呼ぶ。
 * `expected` は読んだときの更新日時(ミリ秒)で、null なら見ない
 */
export const moveWikiPageInTx = async (
  tx: Db,
  actor: Actor,
  writer: WikiWriter,
  access: WikiSpaceAccess,
  pageId: string,
  target: WikiPageMoveTarget,
  opts: WriteOpts & { expected: number | null; expectedPlace?: WikiPageExpectedPlace },
): Promise<WikiPageWriteResult> => {
  if (isFlatWikiSpace(access.type)) {
    throw errWikiAnnouncementFlat()
  }
  const { spaceId } = access
  const rows = await loadWikiTree(tx, access)
  const index = indexWikiTree(rows)
  if (!index.byId.has(pageId)) {
    throw errInvalidOperation()
  }
  const currentParentId = index.byId.get(pageId)?.parentId ?? null
  if (opts.expectedPlace) {
    const { parentId: expectedParentId, siblingIds: expectedSiblingIds } = opts.expectedPlace
    if (expectedParentId !== currentParentId || !isSameOrder(expectedSiblingIds, siblingIdsOf(rows, currentParentId))) {
      throw errTreeChanged()
    }
  }
  const parentId = target.parentId === undefined ? currentParentId : target.parentId
  if (parentId !== null) {
    if (!index.byId.has(parentId) || isSelfOrDescendant(index, pageId, parentId)) {
      throw errInvalidParent()
    }
    if (depthOf(index, parentId) + subtreeHeight(index, pageId) > MAX_WIKI_DEPTH) {
      throw errTooDeep()
    }
  }

  await lockWikiPages(tx, [pageId])
  const existing = await tx.wikiPage.findUniqueOrThrow({
    where: { id: pageId },
    select: { ...SNAPSHOT_SELECT, number: true, updatedAt: true },
  })
  assertNotConflicted(opts.expected, existing.updatedAt)
  const ref = wikiPageRef({ key: access.key, number: existing.number })

  // 保存されている order は隙間や同値を含みうるので、変化の有無は兄弟の並び(id の列)で比べる
  const current = siblingIdsOf(rows, parentId)
  const ordered = placeInSiblings(current, pageId, positionOf(current, pageId, target))
  if (parentId === existing.parentId && isSameOrder(ordered, current)) {
    return { result: 'unchanged', id: pageId, ref, number: existing.number, updatedAt: existing.updatedAt }
  }

  const ticketId = await resolveRevisionTicketId(tx, actor, opts.ticketId)
  const order = ordered.indexOf(pageId)
  await applySiblingOrders(tx, rows, ordered, pageId)
  // updatedAt は @updatedAt なので、明示しないと進んでしまう
  await tx.wikiPage.update({
    where: { id: pageId },
    data: { parentId, order, updatedAt: existing.updatedAt },
    select: { id: true },
  })
  await writeWikiPageRevision(tx, {
    spaceId,
    pageId,
    action: 'moved',
    snapshot: { ...snapshotOf(existing), parentId, order },
    actorId: actor.id,
    via: writer.via,
    ticketId,
  })
  return { result: 'moved', id: pageId, ref, number: existing.number, updatedAt: existing.updatedAt }
}

/**
 * 親・兄弟内の位置の変更。自分自身や子孫の下へは移せず、移した後の部分木が深さの上限を超えるなら弾く。
 * 同じ親の中での並べ替えもこれで行う。`parentId` を省略すると、ロックを取った後に読んだ今の親のまま並べ替える。
 * `expectedPlace` は呼び出し側が見ていた親と兄弟の並び(自分を含む)で、今と違えば(他の人が別の親へ移した・兄弟を増減や並べ替えしたなら)弾く。
 * `afterId` を渡すと `position` の代わりに、ロックを取った後の移動先の兄弟の並びでそのページの直後へ置く(呼び出し側が見ていた番号は、
 * 兄弟が増減するとずれるため)。そのページが移動先の兄弟にいなければ(別の親へ移された・消された)弾く。
 * 動かしたページも押し出された兄弟と同じく、更新日時と更新者を変えない(移動した人と時刻は moved の版に残る)
 */
export const moveWikiPage = async (
  actor: Actor,
  writer: WikiWriter,
  pageId: string,
  target: WikiPageMoveTarget,
  opts: ExpectOpts & { expectedPlace?: WikiPageExpectedPlace } = {},
): Promise<WikiPageWriteResult> => {
  const expected = parseExpectedUpdatedAt(opts.expectedUpdatedAt)
  const spaceId = await findPageSpace(pageId)
  const outcome = await prisma.$transaction(async (tx) => {
    await lockWikiSpace(tx, spaceId)
    const access = await assertWikiSpaceAccess(actor, spaceId, 'write', tx)
    return moveWikiPageInTx(tx, actor, writer, access, pageId, target, {
      expected,
      expectedPlace: opts.expectedPlace,
      ticketId: opts.ticketId,
    })
  })

  if (outcome.result === 'moved') {
    logger.info({ userId: actor.id, id: pageId, parentId: target.parentId, via: writer.via }, 'wiki page moved')
  }
  return outcome
}

/** スペースのツリー(本文なし)。兄弟の並び順で返す。表示用にタグの ID を添える。平らな区分は空を返す */
export const getWikiTree = async (actor: Actor, spaceId: string) => {
  const access = await assertWikiSpaceAccess(actor, spaceId, 'view')
  if (isFlatWikiSpace(access.type)) {
    return []
  }
  const rows = await prisma.wikiPage.findMany({
    where: { spaceId, ...WIKI_PAGE_ALIVE },
    select: { ...TREE_SELECT, tags: { select: { tagId: true } } },
    orderBy: [...TREE_ORDER],
  })
  return rows.map(({ tags, ...row }) => ({ ...row, tagIds: tags.map(({ tagId }) => tagId) }))
}
