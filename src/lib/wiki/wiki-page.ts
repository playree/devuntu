/**
 * Wiki ページの作成・更新・移動・削除と参照(サーバー専用)
 *
 * 閲覧は viewer 以上、書き込みは editor 以上(アーカイブ済みのスペースは不可)。変更はすべて版として残し(wiki-revision.ts)、
 * 版の内容へ戻せる(`restoreWikiPageRevision`)。
 * 削除は `deletedAt` を立てる論理削除で、削除済みのページは読み書きの対象から外す(`WIKI_PAGE_ALIVE`)。
 * 削除済みは `restoreDeletedWikiPage` で戻し、保持期間を過ぎたら自動メンテナンスで物理削除する。
 *
 * 書き込みは必ずスペース行のロックを先に取り、その後で権限(アーカイブを含む)を判定する。
 * - 構造を変える書き込み(作成・移動・削除)は FOR NO KEY UPDATE で直列にし、同時の移動で循環や深さ超過を作らない
 * - 本文の更新は FOR SHARE。更新どうしは並行でき、アーカイブ(スペース行の UPDATE)とは直列になる
 * どちらも版の INSERT が外部キーで取る FOR KEY SHARE とは衝突しない。ページ行のロックは常にスペース行の後に取るので、
 * 「ページ行を持ったままスペース行を待つ」順序は生じない
 */

import { Prisma } from '@/generated/prisma/client'
import type { WikiPageType } from '@/generated/prisma/enums'
import { getTicketAccess, type Actor } from '../board/board-access'
import { ClientError, errInvalidOperation, errValidation } from '../error'
import { logger } from '../logger'
import { prisma, type Db } from '../prisma'
import { assertWikiSpaceAccess, type WikiSpaceAccess } from './wiki-access'
import { skipScheduledWikiAnnouncementsOf } from './wiki-announcement-notify'
import { WIKI_REVISION_ORDER, writeWikiPageRevision } from './wiki-revision'
import {
  MAX_WIKI_CONTENT,
  MAX_WIKI_DEPTH,
  MAX_WIKI_REVISION_MESSAGE,
  MAX_WIKI_TITLE,
  WIKI_ANNOUNCEMENT_FLAT,
  WIKI_PAGE_ALIVE,
  WIKI_PAGE_CONFLICT,
  WIKI_PAGE_HAS_CHILDREN,
  WIKI_PAGE_INVALID_PARENT,
  WIKI_PAGE_TOO_DEEP,
  WIKI_PAGE_TYPE_NOT_ALLOWED,
  WIKI_TREE_CHANGED,
  defaultWikiPageType,
  isFlatWikiSpace,
  isWikiPageTypeAllowed,
  revisionTagsOf,
  wikiPageRef,
  type WikiPageSnapshot,
  type WikiWriter,
} from './wiki-rule'
import { getWikiSpaceByKey } from './wiki-space'
import { assertWikiTagIdsInSpace, findWikiTagsByIds, syncWikiPageTags } from './wiki-tag'
import {
  ancestorIds,
  depthOf,
  descendantIds,
  indexWikiTree,
  isSelfOrDescendant,
  placeInSiblings,
  subtreeHeight,
} from './wiki-tree'

// MCP からも返すので、AI が次の手を選べるようメッセージに理由と対処を書く
const errWikiPageConflict = () =>
  new ClientError(WIKI_PAGE_CONFLICT, 'The page was updated by someone else after you read it. Read it again and retry')
const errHasChildren = (count: number) =>
  new ClientError(
    WIKI_PAGE_HAS_CHILDREN,
    `The page has ${count} descendant page(s). Move them first, or delete with recursive=true to delete them together`,
  )
const errTooDeep = () =>
  new ClientError(WIKI_PAGE_TOO_DEEP, `Pages can be nested at most ${MAX_WIKI_DEPTH} levels deep`)
const errInvalidParent = () =>
  new ClientError(
    WIKI_PAGE_INVALID_PARENT,
    'The parent must be another page in the same space, and not the page itself or one of its descendants',
  )
const errTreeChanged = () =>
  new ClientError(
    WIKI_TREE_CHANGED,
    'The page tree was changed by someone else after you read it. Read the tree again and retry',
  )

const errTypeNotAllowed = (access: WikiSpaceAccess) =>
  new ClientError(
    WIKI_PAGE_TYPE_NOT_ALLOWED,
    access.type === 'announcement'
      ? 'This space is an announcement space: its pages must be normal pages (type=page)'
      : 'This space is a design doc space: its pages must be design docs (type=design_doc)',
  )
export const errWikiAnnouncementFlat = () =>
  new ClientError(
    WIKI_ANNOUNCEMENT_FLAT,
    'This space is an announcement space: pages are flat and ordered by creation date, so parent, position and moving are not available',
  )

/** スペースの区分で作れない種類なら弾く(スペース行のロックを取った後に読んだ区分で判定する) */
const assertPageTypeAllowed = (access: WikiSpaceAccess, type: WikiPageType) => {
  if (!isWikiPageTypeAllowed(access.type, type)) {
    throw errTypeNotAllowed(access)
  }
}

const assertTitle = (title: string) => {
  if (title.trim() === '' || title.length > MAX_WIKI_TITLE) {
    throw errValidation(`title must be 1 to ${MAX_WIKI_TITLE} characters`)
  }
}

const assertContent = (content: string) => {
  if (content.length > MAX_WIKI_CONTENT) {
    throw errValidation(`content must be at most ${MAX_WIKI_CONTENT} characters`)
  }
}

/** 構造を変える書き込みのロック */
const lockSpaceForStructure = async (tx: Db, spaceId: string) => {
  await tx.$queryRaw`SELECT "id" FROM "wiki_space" WHERE "id" = ${spaceId} FOR NO KEY UPDATE`
}

/** 本文の更新のロック。アーカイブと直列にする */
const lockSpaceForContent = async (tx: Db, spaceId: string) => {
  await tx.$queryRaw`SELECT "id" FROM "wiki_space" WHERE "id" = ${spaceId} FOR SHARE`
}

const lockPageRows = async (tx: Db, pageIds: readonly string[]) => {
  await tx.$queryRaw`SELECT "id" FROM "wiki_page" WHERE "id" IN (${Prisma.join(pageIds)}) FOR NO KEY UPDATE`
}

const TREE_SELECT = { id: true, parentId: true, number: true, title: true, order: true } as const
const TREE_ORDER = [{ order: 'asc' }, { number: 'asc' }] as const

/** スペースの木(削除済みを除く、本文なし)。兄弟の並び順で返す */
const loadTree = (tx: Db, spaceId: string) =>
  tx.wikiPage.findMany({ where: { spaceId, ...WIKI_PAGE_ALIVE }, select: TREE_SELECT, orderBy: [...TREE_ORDER] })

type TreeRow = { id: string; parentId: string | null; order: number }

const siblingIdsOf = (rows: readonly TreeRow[], parentId: string | null) =>
  rows.filter((row) => row.parentId === parentId).map(({ id }) => id)

/**
 * 兄弟を `orderedIds` の並び(0 始まり)に振り直す。値が変わる行だけを 1 文で更新し、`skipId` の行は呼び出し側で書く。
 * 位置は本文の保存が上書きしない項目なので、更新日時は変えない(編集中の人の expectedUpdatedAt を競合にしないため)
 */
const applySiblingOrders = async (tx: Db, rows: readonly TreeRow[], orderedIds: readonly string[], skipId: string) => {
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

/** 版に紐づけるチケット。閲覧できないチケットは紐づけない(存在の有無を区別させない) */
const resolveRevisionTicketId = async (tx: Db, actor: Actor, ticketId: string | null | undefined) => {
  if (!ticketId) {
    return null
  }
  if (!(await getTicketAccess(actor, ticketId, tx))?.canView) {
    throw errValidation('ticketId must be a ticket you can view')
  }
  return ticketId
}

/** ページのタグの並び。タグ管理の表示順(同値なら名前順)にそろえる */
const PAGE_TAG_ORDER: Prisma.WikiPageTagOrderByWithRelationInput[] = [
  { tag: { order: 'asc' } },
  { tag: { name: 'asc' } },
]

const SNAPSHOT_SELECT = {
  parentId: true,
  order: true,
  title: true,
  content: true,
  type: true,
  tags: {
    select: { tag: { select: { id: true, name: true } } },
    orderBy: PAGE_TAG_ORDER,
  },
} as const

type SnapshotRow = {
  parentId: string | null
  order: number
  title: string
  content: string
  type: WikiPageType
  tags: { tag: { id: string; name: string } }[]
}

const snapshotOf = ({ parentId, order, title, content, type, tags }: SnapshotRow): WikiPageSnapshot => ({
  parentId,
  order,
  title,
  content,
  type,
  tags: tags.map(({ tag }) => tag),
})

export type WikiPageWriteResult = {
  result: 'created' | 'updated' | 'moved' | 'unchanged'
  id: string
  /** `KEY/番号` */
  ref: string
  number: number
  updatedAt: Date
}

type WriteOpts = { ticketId?: string | null }
/** 本文を書く操作(作成・更新)の版に付けるコミットメッセージ(任意) */
type MessageOpts = { message?: string | null }
type ExpectOpts = WriteOpts & { expectedUpdatedAt?: string }

/** コミットメッセージは前後の空白を除き、空なら付けない */
const normalizeMessage = (message: string | null | undefined): string | null => {
  const trimmed = message?.trim() ?? ''
  if (trimmed.length > MAX_WIKI_REVISION_MESSAGE) {
    throw errValidation(`message must be at most ${MAX_WIKI_REVISION_MESSAGE} characters`)
  }
  return trimmed || null
}

/** `expectedUpdatedAt` が日時として読めなければ入力不正(競合と返すと、読み直しても解消しないため) */
const parseExpectedUpdatedAt = (raw: string | undefined): number | null => {
  if (!raw) {
    return null
  }
  const time = new Date(raw).getTime()
  if (Number.isNaN(time)) {
    throw errValidation('expectedUpdatedAt must be an ISO 8601 date-time')
  }
  return time
}

const assertNotConflicted = (expected: number | null, updatedAt: Date) => {
  if (expected !== null && expected !== updatedAt.getTime()) {
    throw errWikiPageConflict()
  }
}

/** 呼び出し側で読んだ内容に手を加えてから保存するとき(MCP の edits)の競合判定。日時として読めなければ入力不正 */
export const assertWikiPageNotConflicted = (expectedUpdatedAt: string | undefined, updatedAt: Date) =>
  assertNotConflicted(parseExpectedUpdatedAt(expectedUpdatedAt), updatedAt)

export type CreateWikiPageInput = {
  title: string
  content?: string
  /** 種類。省略で区分の既定(設計書スペースは設計書、ほかは通常のページ) */
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
  const content = input.content ?? ''
  assertTitle(title)
  assertContent(content)
  const message = normalizeMessage(opts.message)
  const parentId = input.parentId ?? null

  const page = await prisma.$transaction(async (tx) => {
    await lockSpaceForStructure(tx, spaceId)
    const access = await assertWikiSpaceAccess(actor, spaceId, 'write', tx)
    const type = input.type ?? defaultWikiPageType(access.type)
    assertPageTypeAllowed(access, type)
    // アナウンス用スペースは平らで並びを持たないので、親・位置を受けず、増え続ける全件の木も読まない
    const isFlat = isFlatWikiSpace(access.type)
    if (isFlat && (parentId !== null || input.position !== undefined)) {
      throw errWikiAnnouncementFlat()
    }
    const rows = isFlat ? [] : await loadTree(tx, spaceId)
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

/** 本文と更新日時(部分更新の組み立て用。削除済みは除く。権限は見ない)。無ければ null */
export const readWikiPageContent = async (pageId: string) =>
  prisma.wikiPage.findUnique({ where: { id: pageId, ...WIKI_PAGE_ALIVE }, select: { content: true, updatedAt: true } })

/**
 * 対象ページのスペースを引く(ロックを取る前に要る)。無ければ errInvalidOperation。
 * スペースは変わらないので、ロックの後で削除済みかどうかを読み直す
 */
const findPageSpace = async (pageId: string) => {
  const page = await prisma.wikiPage.findUnique({ where: { id: pageId }, select: { spaceId: true } })
  if (!page) {
    throw errInvalidOperation()
  }
  return page.spaceId
}

/**
 * タイトル・本文・種類・タグの更新。`patch` の undefined の項目はそのまま残す。`tagIds` は渡した集合に置き換える。
 * `expectedUpdatedAt`(ISO 8601)を渡すと、読んだ後に他の人が更新していれば WIKI_PAGE_CONFLICT で弾く
 */
export const updateWikiPage = async (
  actor: Actor,
  writer: WikiWriter,
  pageId: string,
  patch: { title?: string; content?: string; type?: WikiPageType; tagIds?: string[] },
  opts: ExpectOpts & MessageOpts = {},
): Promise<WikiPageWriteResult> => {
  const expected = parseExpectedUpdatedAt(opts.expectedUpdatedAt)
  const message = normalizeMessage(opts.message)
  const spaceId = await findPageSpace(pageId)
  const outcome = await prisma.$transaction(async (tx) => {
    await lockSpaceForContent(tx, spaceId)
    const access = await assertWikiSpaceAccess(actor, spaceId, 'write', tx)
    await lockPageRows(tx, [pageId])
    const existing = await tx.wikiPage.findUnique({
      where: { id: pageId, ...WIKI_PAGE_ALIVE },
      select: { ...SNAPSHOT_SELECT, number: true, updatedAt: true },
    })
    if (!existing) {
      throw errInvalidOperation()
    }
    assertNotConflicted(expected, existing.updatedAt)

    const before = snapshotOf(existing)
    const currentTagIds = existing.tags.map(({ tag }) => tag.id)
    const nextTags = patch.tagIds && (await assertWikiTagIdsInSpace(tx, spaceId, patch.tagIds))
    const next: WikiPageSnapshot = {
      ...before,
      title: patch.title?.trim() ?? before.title,
      content: patch.content ?? before.content,
      type: patch.type ?? before.type,
      tags: nextTags ?? before.tags,
    }
    assertTitle(next.title)
    assertContent(next.content)
    if (next.type !== before.type) {
      assertPageTypeAllowed(access, next.type)
    }
    const ref = wikiPageRef({ key: access.key, number: existing.number })
    const tagsChanged =
      nextTags !== undefined &&
      (nextTags.length !== currentTagIds.length || nextTags.some(({ id }) => !currentTagIds.includes(id)))
    if (next.title === before.title && next.content === before.content && next.type === before.type && !tagsChanged) {
      return { result: 'unchanged' as const, id: pageId, ref, number: existing.number, updatedAt: existing.updatedAt }
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
    if (nextTags && tagsChanged) {
      await syncWikiPageTags(
        tx,
        pageId,
        currentTagIds,
        nextTags.map(({ id }) => id),
      )
    }
    await writeWikiPageRevision(tx, {
      spaceId,
      pageId,
      action: 'updated',
      snapshot: next,
      actorId: actor.id,
      via: writer.via,
      ticketId,
      message,
    })
    return { result: 'updated' as const, id: pageId, ref, number: existing.number, updatedAt: updated.updatedAt }
  })

  if (outcome.result === 'updated') {
    logger.info({ userId: actor.id, id: pageId, via: writer.via }, 'wiki page updated')
  }
  return outcome
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
  target: { parentId?: string | null; position?: number; afterId?: string },
  opts: ExpectOpts & { expectedPlace?: { parentId: string | null; siblingIds: readonly string[] } } = {},
): Promise<WikiPageWriteResult> => {
  const expected = parseExpectedUpdatedAt(opts.expectedUpdatedAt)
  const spaceId = await findPageSpace(pageId)
  const outcome = await prisma.$transaction(async (tx) => {
    await lockSpaceForStructure(tx, spaceId)
    const access = await assertWikiSpaceAccess(actor, spaceId, 'write', tx)
    if (isFlatWikiSpace(access.type)) {
      throw errWikiAnnouncementFlat()
    }
    const rows = await loadTree(tx, spaceId)
    const index = indexWikiTree(rows)
    if (!index.byId.has(pageId)) {
      throw errInvalidOperation()
    }
    const currentParentId = index.byId.get(pageId)?.parentId ?? null
    if (opts.expectedPlace) {
      const { parentId: expectedParentId, siblingIds: expectedSiblingIds } = opts.expectedPlace
      const currentSiblingIds = siblingIdsOf(rows, currentParentId)
      if (
        expectedParentId !== currentParentId ||
        expectedSiblingIds.length !== currentSiblingIds.length ||
        expectedSiblingIds.some((id, i) => currentSiblingIds[i] !== id)
      ) {
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

    await lockPageRows(tx, [pageId])
    const existing = await tx.wikiPage.findUniqueOrThrow({
      where: { id: pageId },
      select: { ...SNAPSHOT_SELECT, number: true, updatedAt: true },
    })
    assertNotConflicted(expected, existing.updatedAt)
    const ref = wikiPageRef({ key: access.key, number: existing.number })

    // 保存されている order は隙間や同値を含みうるので、変化の有無は兄弟の並び(id の列)で比べる
    const current = siblingIdsOf(rows, parentId)
    const ordered = placeInSiblings(current, pageId, positionOf(current, pageId, target))
    if (parentId === existing.parentId && ordered.every((id, i) => current[i] === id)) {
      return { result: 'unchanged' as const, id: pageId, ref, number: existing.number, updatedAt: existing.updatedAt }
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
    return { result: 'moved' as const, id: pageId, ref, number: existing.number, updatedAt: existing.updatedAt }
  })

  if (outcome.result === 'moved') {
    logger.info({ userId: actor.id, id: pageId, parentId: target.parentId, via: writer.via }, 'wiki page moved')
  }
  return outcome
}

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
    await lockSpaceForStructure(tx, spaceId)
    const access = await assertWikiSpaceAccess(actor, spaceId, 'write', tx)
    // アナウンス用スペースは平らで子を持たないので、増え続ける全件の木は読まずにページの有無だけを見る
    const isFlat = isFlatWikiSpace(access.type)
    const index = isFlat ? null : indexWikiTree(await loadTree(tx, spaceId))
    const exists = index
      ? index.byId.has(pageId)
      : (await tx.wikiPage.findFirst({ where: { id: pageId, spaceId, ...WIKI_PAGE_ALIVE }, select: { id: true } })) !==
        null
    if (!exists) {
      throw errInvalidOperation()
    }
    const descendants = index ? descendantIds(index, pageId) : []
    if (opts.expectedDescendantIds) {
      const expectedIds = new Set(opts.expectedDescendantIds)
      if (expectedIds.size !== descendants.length || descendants.some((id) => !expectedIds.has(id))) {
        throw errTreeChanged()
      }
    }
    if (descendants.length > 0 && !opts.recursive) {
      throw errHasChildren(descendants.length)
    }
    const ticketId = await resolveRevisionTicketId(tx, actor, opts.ticketId)

    // 並行する本文の更新を待ってから読み、deleted の版に最後の内容を残す
    const targetIds = [pageId, ...descendants]
    await lockPageRows(tx, targetIds)
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
    await lockSpaceForContent(tx, spaceId)
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
    await lockPageRows(tx, [pageId])
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
    const tagsChanged = tagIds.length !== currentTagIds.length || tagIds.some((id) => !currentTagIds.includes(id))
    if (
      existing.title === revision.title &&
      existing.content === revision.content &&
      existing.type === revision.type &&
      !tagsChanged
    ) {
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
    if (tagsChanged) {
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
    await lockSpaceForStructure(tx, spaceId)
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
    if (opts.expectedDescendantIds) {
      const expectedIds = new Set(opts.expectedDescendantIds)
      if (expectedIds.size !== descendants.length || descendants.some((id) => !expectedIds.has(id))) {
        throw errTreeChanged()
      }
    }
    const restoreIds = [...(target.deletedAt ? [pageId] : []), ...descendants]
    if (restoreIds.length === 0) {
      return { result: 'unchanged' as const, id: pageId, ref, number: target.number, restored: 0 }
    }
    await lockPageRows(tx, restoreIds)

    if (target.deletedAt) {
      // アナウンス用スペースは平らなので、全件の木は読まずにスペース直下へ戻す
      const isFlat = isFlatWikiSpace(access.type)
      const rows = isFlat ? [] : await loadTree(tx, spaceId)
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
    } else if (!isFlatWikiSpace(access.type)) {
      // 戻されたページの下へ配下を戻す。そのページが深い位置へ移されていれば上限を超えうる
      const index = indexWikiTree(await loadTree(tx, spaceId))
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

/** スペースのツリー(本文なし)。兄弟の並び順で返す。表示用にタグの ID を添える */
export const getWikiTree = async (actor: Actor, spaceId: string) => {
  await assertWikiSpaceAccess(actor, spaceId, 'view')
  const rows = await prisma.wikiPage.findMany({
    where: { spaceId, ...WIKI_PAGE_ALIVE },
    select: { ...TREE_SELECT, tags: { select: { tagId: true } } },
    orderBy: [...TREE_ORDER],
  })
  return rows.map(({ tags, ...row }) => ({ ...row, tagIds: tags.map(({ tagId }) => tagId) }))
}

export type WikiTreeItem = Awaited<ReturnType<typeof getWikiTree>>[number]

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
    isFlatWikiSpace(space.type) ? [] : loadTree(prisma, space.id),
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
