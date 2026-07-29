/**
 * タグの参照・更新(サーバー専用)
 *
 * prisma に依存するため、クライアントからは import しないこと。
 * (クライアントからも使える純粋関数は `task.ts` を参照)
 *
 * タグは常にボードに属する(プライベートもプライベートボードに属する)ため、
 * スコープの分岐は無い。ボードの認可は呼び出し側が `assertBoardAccess` で通すこと。
 */

import type { Prisma } from '@/generated/prisma/client'
import type { TagColor } from '@/generated/prisma/enums'
import { errClient, errInvalidOperation } from './error'
import { prisma } from './prisma'
import { diffTagIds } from './task'

type Db = Prisma.TransactionClient | typeof prisma

/** タグの選択肢。フォーム / 検索パネル / チップ表示で共有する */
export type TagOption = {
  id: string
  boardId: string
  name: string
  color: TagColor
  order: number
}

/** タグ管理画面用。使用中のチケット件数を含む */
export type TagManageItem = TagOption & { ticketCount: number }

const TAG_SELECT = { id: true, boardId: true, name: true, color: true, order: true } as const

/** 同値の order でも並びが揺れないよう name を第 2 キーにする */
const TAG_ORDER_BY = [{ order: 'asc' }, { name: 'asc' }] as const

/** 重複タグ名は DB の @@unique([boardId, name]) で弾かれる。クライアントへ専用コードで返す */
const DUPLICATED_TAG_NAME = 'DUPLICATED_TAG_NAME'

const isUniqueViolation = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'P2002'

/** 重複名の一意制約違反を DUPLICATED_TAG_NAME へ変換して再 throw する */
export const rethrowDuplicatedTagName = (e: unknown): never => {
  if (isUniqueViolation(e)) {
    throw errClient(DUPLICATED_TAG_NAME)
  }
  throw e
}

/** ボード 1 つのタグ一覧(表示順) */
export const listBoardTags = async (boardId: string, tx: Db = prisma): Promise<TagOption[]> =>
  tx.tag.findMany({ where: { boardId }, select: TAG_SELECT, orderBy: [...TAG_ORDER_BY] })

/** ボード 1 つのタグ一覧 + 使用件数(タグ管理画面用) */
export const listBoardTagsForManage = async (boardId: string, tx: Db = prisma): Promise<TagManageItem[]> => {
  const tags = await tx.tag.findMany({
    where: { boardId },
    select: { ...TAG_SELECT, _count: { select: { tickets: true } } },
    orderBy: [...TAG_ORDER_BY],
  })
  return tags.map(({ _count, ...tag }) => ({ ...tag, ticketCount: _count.tickets }))
}

/**
 * アクセス可能な全ボードのタグ(フォーム / 検索パネルの選択肢)。
 * 呼び出し側は `getAccessibleBoardIds` の結果をそのまま渡す。
 */
export const listVisibleTags = async (accessibleBoardIds: string[]): Promise<TagOption[]> => {
  if (accessibleBoardIds.length === 0) {
    return []
  }
  return prisma.tag.findMany({
    where: { boardId: { in: accessibleBoardIds } },
    select: TAG_SELECT,
    orderBy: [...TAG_ORDER_BY],
  })
}

/**
 * 指定された tagId がすべてそのボードのタグであることを検証する。NG なら errInvalidOperation()。
 *
 * ボードを跨いだラベル付けは DB 制約では防げないため、チケットの作成 / 更新の
 * 両方でこの関数を必ず通すこと。戻り値は重複を除いた tagId。
 */
export const assertTagIdsInBoard = async (tx: Db, boardId: string, tagIds: string[]): Promise<string[]> => {
  const ids = [...new Set(tagIds)]
  if (ids.length === 0) {
    return []
  }

  const count = await tx.tag.count({ where: { id: { in: ids }, boardId } })
  if (count !== ids.length) {
    throw errInvalidOperation()
  }
  return ids
}

/**
 * チケットに紐づくタグを総入れ替えする(syncBoardMembers と同じ思想)。
 * 変化しない tagId は触らないことで、不要な DELETE / INSERT を避ける。
 */
export const syncTicketTags = async (
  tx: Prisma.TransactionClient,
  ticketId: string,
  tagIds: string[],
): Promise<void> => {
  const current = await tx.ticketTag.findMany({ where: { ticketId }, select: { tagId: true } })
  const { toAdd, toRemove } = diffTagIds(
    current.map((row) => row.tagId),
    tagIds,
  )

  if (toRemove.length > 0) {
    await tx.ticketTag.deleteMany({ where: { ticketId, tagId: { in: toRemove } } })
  }
  if (toAdd.length > 0) {
    await tx.ticketTag.createMany({ data: toAdd.map((tagId) => ({ ticketId, tagId })) })
  }
}

/**
 * 同一ボード内のタグを統合する。source が付いていたチケットへ target を付け、source を削除する。
 * 両方付いていたチケットで重複行にならないよう skipDuplicates を使う。
 */
export const mergeTags = async (
  tx: Prisma.TransactionClient,
  boardId: string,
  sourceId: string,
  targetId: string,
): Promise<void> => {
  const [source, target] = await Promise.all([
    tx.tag.findUnique({ where: { id: sourceId }, select: { id: true, boardId: true } }),
    tx.tag.findUnique({ where: { id: targetId }, select: { id: true, boardId: true } }),
  ])

  // ボードを跨いだ統合はタグの所属を壊すので許可しない
  if (!source || !target || source.id === target.id || source.boardId !== boardId || target.boardId !== boardId) {
    throw errInvalidOperation()
  }

  const links = await tx.ticketTag.findMany({ where: { tagId: source.id }, select: { ticketId: true } })
  if (links.length > 0) {
    await tx.ticketTag.createMany({
      data: links.map(({ ticketId }) => ({ ticketId, tagId: target.id })),
      skipDuplicates: true,
    })
  }

  // 残った source 側の TicketTag は onDelete: Cascade で消える
  await tx.tag.delete({ where: { id: source.id } })
}
