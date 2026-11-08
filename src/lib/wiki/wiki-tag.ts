/**
 * Wiki のタグ(サーバー専用)。スペースごとに持ち、ボードのタグ(`board/tag.ts`)と同じ規則で扱う
 *
 * - 作成は editor 以上(ページの編集中に新しいタグが要る)、更新・削除は manage
 * - ページへの付与は、同じスペースのタグだけに限る(DB 制約では防げないので `assertWikiTagIdsInSpace` を必ず通す)
 */

import type { Prisma } from '@/generated/prisma/client'
import type { TagColor } from '@/generated/prisma/enums'
import type { Actor } from '../board/board-access'
import { rethrowDuplicatedTagName } from '../board/tag'
import { diffTagIds, MAX_TAGS_PER_SCOPE, nextOrder } from '../board/tag-rule'
import { errInvalidOperation, errValidation } from '../error'
import { logger } from '../logger'
import { prisma, type Db } from '../prisma'
import { assertWikiSpaceAccess, getWikiSpaceAccess } from './wiki-access'
import { MAX_WIKI_PAGE_TAGS } from './wiki-rule'

export type WikiTagOption = { id: string; name: string; color: TagColor; order: number }

/** タグ管理画面用。付与しているページ数を含む */
export type WikiTagManageItem = WikiTagOption & { usageCount: number }

export const WIKI_TAG_SELECT = { id: true, name: true, color: true, order: true } as const

/** 同値の order でも並びが揺れないよう name を第 2 キーにする */
export const WIKI_TAG_ORDER_BY = [{ order: 'asc' }, { name: 'asc' }] as const

type WikiTagInput = { name: string; color: TagColor; order?: number }

/** スペースのタグ一覧(表示順) */
export const listWikiTags = async (spaceId: string, tx: Db = prisma): Promise<WikiTagOption[]> =>
  tx.wikiTag.findMany({ where: { spaceId }, select: WIKI_TAG_SELECT, orderBy: [...WIKI_TAG_ORDER_BY] })

/**
 * タグ管理画面用の一覧。閲覧か管理ができれば読める(割り当ての無い管理者もタグを管理できる)。
 * 変更の可否は画面側で権限を見て切り替える
 */
export const listWikiTagsForManage = async (actor: Actor, spaceId: string): Promise<WikiTagManageItem[]> => {
  const access = await getWikiSpaceAccess(actor, spaceId)
  if (!access?.canView && !access?.canManage) {
    throw errInvalidOperation()
  }
  const tags = await prisma.wikiTag.findMany({
    where: { spaceId },
    select: { ...WIKI_TAG_SELECT, _count: { select: { pages: true } } },
    orderBy: [...WIKI_TAG_ORDER_BY],
  })
  return tags.map(({ _count, ...tag }) => ({ ...tag, usageCount: _count.pages }))
}

/**
 * 付与するタグがすべてそのスペースのものかを確かめる。NG なら errInvalidOperation()。
 * 戻り値は重複を除いたタグを表示順に並べたもの(版の tagNames に使う)
 */
export const assertWikiTagIdsInSpace = async (
  tx: Db,
  spaceId: string,
  tagIds: readonly string[],
): Promise<{ id: string; name: string }[]> => {
  const ids = [...new Set(tagIds)]
  if (ids.length > MAX_WIKI_PAGE_TAGS) {
    throw errValidation(`a page can have at most ${MAX_WIKI_PAGE_TAGS} tags`)
  }
  if (ids.length === 0) {
    return []
  }
  const tags = await tx.wikiTag.findMany({
    where: { id: { in: ids }, spaceId },
    select: { id: true, name: true },
    orderBy: [...WIKI_TAG_ORDER_BY],
  })
  if (tags.length !== ids.length) {
    throw errInvalidOperation()
  }
  return tags
}

/** ページのタグを総入れ替えする。変化しない tagId は触らない */
export const syncWikiPageTags = async (
  tx: Prisma.TransactionClient,
  pageId: string,
  current: readonly string[],
  next: readonly string[],
): Promise<void> => {
  const { toAdd, toRemove } = diffTagIds([...current], [...next])
  if (toRemove.length > 0) {
    await tx.wikiPageTag.deleteMany({ where: { pageId, tagId: { in: toRemove } } })
  }
  if (toAdd.length > 0) {
    await tx.wikiPageTag.createMany({ data: toAdd.map((tagId) => ({ pageId, tagId })), skipDuplicates: true })
  }
}

/** タグの作成。スペース行をロックしてから件数を数え、同時の作成で上限を超えないようにする */
export const createWikiTag = async (
  actor: Actor,
  spaceId: string,
  { name, color, order }: WikiTagInput,
): Promise<WikiTagOption> => {
  const tag = await prisma
    .$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "wiki_space" WHERE "id" = ${spaceId} FOR NO KEY UPDATE`
      await assertWikiSpaceAccess(actor, spaceId, 'write', tx)
      const tags = await tx.wikiTag.findMany({ where: { spaceId }, select: { order: true } })
      if (tags.length >= MAX_TAGS_PER_SCOPE) {
        throw errInvalidOperation()
      }
      return tx.wikiTag.create({
        data: { spaceId, name, color, order: order ?? nextOrder(tags.map((row) => row.order)) },
        select: WIKI_TAG_SELECT,
      })
    })
    .catch(rethrowDuplicatedTagName)

  logger.info({ userId: actor.id, spaceId, id: tag.id }, 'wiki tag created')
  return tag
}

const findTagSpace = async (id: string) => {
  const tag = await prisma.wikiTag.findUnique({ where: { id }, select: { spaceId: true } })
  if (!tag) {
    throw errInvalidOperation()
  }
  return tag.spaceId
}

/** タグの更新(名前・色・表示順)。manage が必要 */
export const updateWikiTag = async (
  actor: Actor,
  { id, name, color, order }: WikiTagInput & { id: string; order: number },
): Promise<WikiTagOption> => {
  await assertWikiSpaceAccess(actor, await findTagSpace(id), 'manage')
  const tag = await prisma.wikiTag
    .update({ where: { id }, data: { name, color, order }, select: WIKI_TAG_SELECT })
    .catch(rethrowDuplicatedTagName)

  logger.info({ userId: actor.id, id }, 'wiki tag updated')
  return tag
}

/** タグの削除。manage が必要。ページとの紐付けは Cascade で消える */
export const deleteWikiTag = async (actor: Actor, id: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const target = await tx.wikiTag.findUnique({ where: { id }, select: { spaceId: true } })
    if (!target) {
      throw errInvalidOperation()
    }
    await assertWikiSpaceAccess(actor, target.spaceId, 'manage', tx)
    await tx.wikiTag.delete({ where: { id } })
  })

  logger.info({ userId: actor.id, id }, 'wiki tag deleted')
}
