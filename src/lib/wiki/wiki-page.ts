/**
 * Wiki ページの作成・更新・削除と参照(サーバー専用)
 *
 * 閲覧は viewer 以上、書き込みは editor 以上(アーカイブ済みのスペースは不可)。変更はすべて版として残し(wiki-revision.ts)、
 * 版の内容へ戻せる(wiki-page-restore.ts)。移動と木の読み込みは wiki-page-tree.ts、ロックの順序は wiki-lock.ts を参照。
 * 削除は `deletedAt` を立てる論理削除で、削除済みのページは読み書きの対象から外す(`WIKI_PAGE_ALIVE`)。
 * 削除済みは `restoreDeletedWikiPage` で戻し、保持期間を過ぎたら自動メンテナンスで物理削除する。
 */

import { Prisma } from '@/generated/prisma/client'
import type { WikiPageType } from '@/generated/prisma/enums'
import type { Actor } from '../board/board-access'
import { ClientError, errInvalidOperation } from '../error'
import { isSameSet } from '../list-compare'
import { logger } from '../logger'
import { prisma, type Db } from '../prisma'
import { assertWikiSpaceAccess, type WikiSpaceAccess } from './wiki-access'
import { skipScheduledWikiAnnouncementsOf } from './wiki-announcement-notify'
import { designDocFrontMatter, hasFrontMatter } from './wiki-front-matter'
import { lockWikiPages, lockWikiSpace, shareLockWikiSpace } from './wiki-lock'
import {
  applySiblingOrders,
  loadWikiTree,
  moveWikiPageInTx,
  siblingIdsOf,
  type WikiPageMoveTarget,
} from './wiki-page-tree'
import {
  assertContent,
  assertNotConflicted,
  assertPageTypeAllowed,
  assertTitle,
  errInvalidParent,
  errTooDeep,
  errTreeChanged,
  errWikiAnnouncementFlat,
  findPageSpace,
  normalizeMessage,
  PAGE_TAG_ORDER,
  parseExpectedUpdatedAt,
  resolveRevisionTicketId,
  SNAPSHOT_SELECT,
  snapshotOf,
  type ExpectOpts,
  type MessageOpts,
  type WikiPageWriteResult,
  type WriteOpts,
} from './wiki-page-write'
import { WIKI_REVISION_ORDER, writeWikiPageRevision } from './wiki-revision'
import {
  defaultWikiPageType,
  isFlatWikiSpace,
  isWikiPageChanged,
  MAX_WIKI_DEPTH,
  WIKI_PAGE_ALIVE,
  WIKI_PAGE_HAS_CHILDREN,
  wikiPageRef,
  type WikiPageSnapshot,
  type WikiWriter,
} from './wiki-rule'
import { getWikiSpaceByKey } from './wiki-space'
import { assertWikiTagIdsInSpace, syncWikiPageTags } from './wiki-tag'
import { ancestorIds, depthOf, descendantIds, indexWikiTree, placeInSiblings } from './wiki-tree'

const errHasChildren = (count: number) =>
  new ClientError(
    WIKI_PAGE_HAS_CHILDREN,
    `The page has ${count} descendant page(s). Move them first, or delete with recursive=true to delete them together`,
  )

/** ページ番号の採番。スペースの更新日時(設定の変更日時)は動かさない */
const nextPageNumber = async (tx: Db, spaceId: string): Promise<number> => {
  const [row] = await tx.$queryRaw<{ pageSeq: number }[]>`
    UPDATE "wiki_space" SET "pageSeq" = "pageSeq" + 1 WHERE "id" = ${spaceId} RETURNING "pageSeq"
  `
  if (!row) {
    throw errInvalidOperation()
  }
  return row.pageSeq
}

export type CreateWikiPageInput = {
  title: string
  content?: string
  /** 種類。省略で区分の既定(設計書スペースは設計書、ほかは通常のページ)。本文が空の設計書には最小の front matter を入れる */
  type?: WikiPageType
  /** 親ページの id。null / 省略でスペース直下 */
  parentId?: string | null
  /** 兄弟の中での位置(0 始まり)。省略で末尾 */
  position?: number
  /** 付けるタグ(同じスペースのもの) */
  tagIds?: string[]
}

export const createWikiPage = async (
  actor: Actor,
  writer: WikiWriter,
  spaceId: string,
  input: CreateWikiPageInput,
  opts: WriteOpts & MessageOpts = {},
): Promise<WikiPageWriteResult> => {
  const title = input.title.trim()
  const rawContent = input.content ?? ''
  assertTitle(title)
  assertContent(rawContent)
  const message = normalizeMessage(opts.message)
  const parentId = input.parentId ?? null

  const page = await prisma.$transaction(async (tx) => {
    await lockWikiSpace(tx, spaceId)
    const access = await assertWikiSpaceAccess(actor, spaceId, 'write', tx)
    const type = input.type ?? defaultWikiPageType(access.type)
    assertPageTypeAllowed(access, type)
    // 本文が空の設計書は最小の front matter を入れる(ビューアの設計書ヘッダになる)
    const content = type === 'design_doc' && rawContent === '' ? designDocFrontMatter(title) : rawContent
    assertContent(content)
    // アナウンス用スペースは平らで並びを持たないので、親・位置を受けない
    if (isFlatWikiSpace(access.type) && (parentId !== null || input.position !== undefined)) {
      throw errWikiAnnouncementFlat()
    }
    const rows = await loadWikiTree(tx, access)
    if (parentId) {
      const index = indexWikiTree(rows)
      if (!index.byId.has(parentId)) {
        throw errInvalidParent()
      }
      if (depthOf(index, parentId) + 1 > MAX_WIKI_DEPTH) {
        throw errTooDeep()
      }
    }
    const ticketId = await resolveRevisionTicketId(tx, actor, opts.ticketId)
    const tags = await assertWikiTagIdsInSpace(tx, spaceId, input.tagIds ?? [])

    const number = await nextPageNumber(tx, spaceId)
    // 新しいページの id はまだ無いので、空文字を目印に並びを決める
    const ordered = placeInSiblings(siblingIdsOf(rows, parentId), '', input.position)
    const order = ordered.indexOf('')
    await applySiblingOrders(tx, rows, ordered, '')

    const created = await tx.wikiPage.create({
      data: {
        spaceId,
        parentId,
        number,
        title,
        content,
        type,
        order,
        createdById: actor.id,
        updatedById: actor.id,
        updatedVia: writer.via,
      },
      select: { id: true, number: true, updatedAt: true },
    })
    await syncWikiPageTags(
      tx,
      created.id,
      [],
      tags.map(({ id }) => id),
    )
    await writeWikiPageRevision(tx, {
      spaceId,
      pageId: created.id,
      action: 'created',
      snapshot: { parentId, order, title, content, type, tags },
      actorId: actor.id,
      via: writer.via,
      ticketId,
      message,
    })
    return { ...created, ref: wikiPageRef({ key: access.key, number }) }
  })

  logger.info({ userId: actor.id, spaceId, id: page.id, via: writer.via }, 'wiki page created')
  return { result: 'created', ...page }
}

/** スペース内の番号でページを引く(削除済みは除く。権限は見ない。呼び出し側で assertWikiSpaceAccess を通すこと)。無ければ null */
export const findWikiPageByNumber = async (spaceId: string, number: number) =>
  prisma.wikiPage.findUnique({
    where: { spaceId_number: { spaceId, number }, ...WIKI_PAGE_ALIVE },
    select: { id: true, parentId: true, updatedAt: true },
  })

export type WikiPagePatch = {
  title?: string
  /** 本文。関数なら、ロックを取った後に読んだ今の本文から組み立てる(MCP の edits) */
  content?: string | ((current: string) => string)
  type?: WikiPageType
  /** 渡した集合に置き換える */
  tagIds?: string[]
}

/**
 * 更新の本体。スペース行をロックし、書き込みの権限を確かめた後に呼ぶ。
 * 種類を設計書へ変えたときに本文が front matter を持たなければ、最小の front matter を先頭に入れる(画面の編集と同じ)
 */
const updateWikiPageInTx = async (
  tx: Db,
  actor: Actor,
  writer: WikiWriter,
  access: WikiSpaceAccess,
  pageId: string,
  patch: WikiPagePatch,
  opts: WriteOpts & { expected: number | null; message: string | null },
): Promise<WikiPageWriteResult> => {
  const { spaceId } = access
  await lockWikiPages(tx, [pageId])
  const existing = await tx.wikiPage.findUnique({
    where: { id: pageId, ...WIKI_PAGE_ALIVE },
    select: { ...SNAPSHOT_SELECT, number: true, updatedAt: true },
  })
  if (!existing) {
    throw errInvalidOperation()
  }
  assertNotConflicted(opts.expected, existing.updatedAt)

  const before = snapshotOf(existing)
  const currentTagIds = before.tags.map(({ id }) => id)
  const nextTags = patch.tagIds && (await assertWikiTagIdsInSpace(tx, spaceId, patch.tagIds))
  const title = patch.title?.trim() ?? before.title
  const type = patch.type ?? before.type
  const content =
    typeof patch.content === 'function' ? patch.content(before.content) : (patch.content ?? before.content)
  const next: WikiPageSnapshot = {
    ...before,
    title,
    content:
      type === 'design_doc' && before.type !== 'design_doc' && !hasFrontMatter(content)
        ? `${designDocFrontMatter(title)}${content}`
        : content,
    type,
    tags: nextTags ?? before.tags,
  }
  assertTitle(next.title)
  assertContent(next.content)
  if (next.type !== before.type) {
    assertPageTypeAllowed(access, next.type)
  }
  const ref = wikiPageRef({ key: access.key, number: existing.number })
  const nextTagIds = next.tags.map(({ id }) => id)
  if (!isWikiPageChanged({ ...before, tagIds: currentTagIds }, { ...next, tagIds: nextTagIds })) {
    return { result: 'unchanged', id: pageId, ref, number: existing.number, updatedAt: existing.updatedAt }
  }

  const ticketId = await resolveRevisionTicketId(tx, actor, opts.ticketId)
  const updated = await tx.wikiPage.update({
    where: { id: pageId },
    data: {
      title: next.title,
      content: next.content,
      type: next.type,
      updatedById: actor.id,
      updatedVia: writer.via,
    },
    select: { updatedAt: true },
  })
  if (!isSameSet(currentTagIds, nextTagIds)) {
    await syncWikiPageTags(tx, pageId, currentTagIds, nextTagIds)
  }
  await writeWikiPageRevision(tx, {
    spaceId,
    pageId,
    action: 'updated',
    snapshot: next,
    actorId: actor.id,
    via: writer.via,
    ticketId,
    message: opts.message,
  })
  return { result: 'updated', id: pageId, ref, number: existing.number, updatedAt: updated.updatedAt }
}

export type WikiPageSaveResult = {
  /** 最後に書いた(または変わらなかった)ページの状態 */
  written: WikiPageWriteResult
  /** 実際に変えたもの。空なら何も変わっていない */
  changes: ('updated' | 'moved')[]
}

/**
 * 内容の更新と移動を 1 つのトランザクションで行う(MCP の save_wiki_page)。片方が失敗すればどちらも残らない。
 * 移動を含むときはスペース行を構造のロックで取る。`expectedUpdatedAt`(ISO 8601)は最初の書き込みの前に照合する
 */
export const saveWikiPage = async (
  actor: Actor,
  writer: WikiWriter,
  pageId: string,
  change: { patch?: WikiPagePatch; move?: WikiPageMoveTarget },
  opts: ExpectOpts & MessageOpts = {},
): Promise<WikiPageSaveResult> => {
  const expected = parseExpectedUpdatedAt(opts.expectedUpdatedAt)
  const message = normalizeMessage(opts.message)
  const spaceId = await findPageSpace(pageId)
  const outcome = await prisma.$transaction(async (tx) => {
    if (change.move) {
      await lockWikiSpace(tx, spaceId)
    } else {
      await shareLockWikiSpace(tx, spaceId)
    }
    const access = await assertWikiSpaceAccess(actor, spaceId, 'write', tx)
    const updated =
      change.patch &&
      (await updateWikiPageInTx(tx, actor, writer, access, pageId, change.patch, {
        expected,
        ticketId: opts.ticketId,
        message,
      }))
    const moved =
      change.move &&
      (await moveWikiPageInTx(tx, actor, writer, access, pageId, change.move, {
        // 更新した後の更新日時は自分の書き込みなので、照合は最初の書き込みだけで行う
        expected: updated ? null : expected,
        ticketId: opts.ticketId,
      }))
    const written = moved ?? updated
    if (!written) {
      throw errInvalidOperation()
    }
    const changes = [updated?.result, moved?.result].filter((result) => result === 'updated' || result === 'moved')
    return { written, changes }
  })

  if (outcome.changes.length > 0) {
    logger.info(
      { userId: actor.id, id: pageId, changes: outcome.changes, parentId: change.move?.parentId, via: writer.via },
      'wiki page saved',
    )
  }
  return outcome
}

/**
 * タイトル・本文・種類・タグの更新。`patch` の undefined の項目はそのまま残す。`tagIds` は渡した集合に置き換える。
 * `expectedUpdatedAt`(ISO 8601)を渡すと、読んだ後に他の人が更新していれば WIKI_PAGE_CONFLICT で弾く
 */
export const updateWikiPage = async (
  actor: Actor,
  writer: WikiWriter,
  pageId: string,
  patch: WikiPagePatch,
  opts: ExpectOpts & MessageOpts = {},
): Promise<WikiPageWriteResult> => (await saveWikiPage(actor, writer, pageId, { patch }, opts)).written

/**
 * ページの削除(ゴミ箱へ移す)。子孫がいれば `recursive` を指定したときだけ配下ごと消す。
 * 対象と配下に同じ `deletedAt` を立て、ページごとに deleted の版を残す。保持期間内なら `restoreDeletedWikiPage` で戻せる。
 * 戻り値は消したページ数。
 * `expectedDescendantIds` は利用者に確認した配下のページで、今の配下と違えば(件数が同じでも入れ替わっていれば)消さずに弾く
 */
export const deleteWikiPage = async (
  actor: Actor,
  writer: WikiWriter,
  pageId: string,
  opts: WriteOpts & { recursive?: boolean; expectedDescendantIds?: readonly string[] } = {},
): Promise<{ deleted: number }> => {
  const spaceId = await findPageSpace(pageId)
  const deleted = await prisma.$transaction(async (tx) => {
    await lockWikiSpace(tx, spaceId)
    const access = await assertWikiSpaceAccess(actor, spaceId, 'write', tx)
    // アナウンス用スペースは平らで子を持たないので、増え続ける全件の木は読まずにページの有無だけを見る
    const index = isFlatWikiSpace(access.type) ? null : indexWikiTree(await loadWikiTree(tx, access))
    const exists = index
      ? index.byId.has(pageId)
      : (await tx.wikiPage.findFirst({ where: { id: pageId, spaceId, ...WIKI_PAGE_ALIVE }, select: { id: true } })) !==
        null
    if (!exists) {
      throw errInvalidOperation()
    }
    const descendants = index ? descendantIds(index, pageId) : []
    if (opts.expectedDescendantIds && !isSameSet(opts.expectedDescendantIds, descendants)) {
      throw errTreeChanged()
    }
    if (descendants.length > 0 && !opts.recursive) {
      throw errHasChildren(descendants.length)
    }
    const ticketId = await resolveRevisionTicketId(tx, actor, opts.ticketId)

    // 並行する本文の更新を待ってから読み、deleted の版に最後の内容を残す
    const targetIds = [pageId, ...descendants]
    await lockWikiPages(tx, targetIds)
    const targets = await tx.wikiPage.findMany({
      where: { id: { in: targetIds } },
      select: { ...SNAPSHOT_SELECT, id: true },
    })
    for (const target of targets) {
      await writeWikiPageRevision(tx, {
        spaceId,
        pageId: target.id,
        action: 'deleted',
        snapshot: snapshotOf(target),
        actorId: actor.id,
        via: writer.via,
        ticketId,
      })
    }
    await skipScheduledWikiAnnouncementsOf(tx, targetIds)
    // 本文は変えないので更新日時は進めない(@updatedAt を避けて SQL で書く)
    await tx.$executeRaw`
      UPDATE "wiki_page" SET "deletedAt" = ${new Date()}, "deletedById" = ${actor.id}
      WHERE "id" IN (${Prisma.join(targetIds)})
    `
    return targets.length
  })

  logger.info({ userId: actor.id, id: pageId, deleted, via: writer.via }, 'wiki page deleted')
  return { deleted }
}

const PAGE_DETAIL_SELECT = {
  id: true,
  spaceId: true,
  parentId: true,
  number: true,
  title: true,
  content: true,
  type: true,
  order: true,
  updatedVia: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { name: true } },
  updatedBy: { select: { name: true, isAgent: true } },
  tags: {
    select: { tag: { select: { id: true, name: true, color: true } } },
    orderBy: PAGE_TAG_ORDER,
  },
} as const

/**
 * `KEY/番号` でページを引く。パンくず(先祖)と子ページの一覧を添える。
 * 画面ではサイドメニューのツリーにも同じ木を使うので、先祖を 1 段ずつ引かず本文抜きの木をまとめて読む。
 * `revisionNumber` はページと同じ時点の最新の版の番号。移動は更新日時を進めずに版だけを足すので、
 * 画面で版の一覧と照合するときは更新日時とあわせて使う
 */
export const getWikiPage = async (actor: Actor, key: string, number: number) => {
  const { space, access } = await getWikiSpaceByKey(actor, key)
  const [page, tree] = await Promise.all([
    // ページと版は同じトランザクションで書くので、同じスナップショットで読めば最新の版とページがそろう
    prisma.$transaction(
      async (tx) => {
        const row = await tx.wikiPage.findUnique({
          where: { spaceId_number: { spaceId: space.id, number }, ...WIKI_PAGE_ALIVE },
          select: PAGE_DETAIL_SELECT,
        })
        if (!row) {
          return null
        }
        const latest = await tx.wikiPageRevision.findFirst({
          where: { pageId: row.id },
          select: { number: true },
          orderBy: WIKI_REVISION_ORDER,
        })
        return { ...row, revisionNumber: latest?.number ?? 0 }
      },
      { isolationLevel: 'RepeatableRead' },
    ),
    // アナウンス用スペースは平らで先祖・子を持たないので、増え続ける全件の木は読まない
    loadWikiTree(prisma, { spaceId: space.id, type: space.type }),
  ])
  if (!page) {
    throw errInvalidOperation()
  }
  const index = indexWikiTree(tree)
  const byId = new Map(tree.map((item) => [item.id, item]))
  const ancestors = ancestorIds(index, page.id)
    .reverse()
    .map((id) => byId.get(id))
    .filter((item) => item !== undefined)
    .map(({ number, title }) => ({ number, title }))
  const children = tree.filter((item) => item.parentId === page.id).map(({ number, title }) => ({ number, title }))
  return { space, access, page, tree, ancestors, children }
}

export type WikiPageDetail = Awaited<ReturnType<typeof getWikiPage>>
