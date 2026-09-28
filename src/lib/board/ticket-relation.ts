/**
 * チケット間の関係(親子 / 関連)の読み書き(サーバー専用)
 *
 * 関係は同じボードのチケット同士だけを結ぶ。ボードが同じなら権限も同じなので、
 * 判定は操作するチケット側の 'edit' だけで足りる。
 */

import type { Prisma } from '@/generated/prisma/client'
import type { TicketRelationType } from '@/generated/prisma/enums'
import { errClient, errInvalidOperation } from '../error'
import { isUniqueViolation, prisma, type Db } from '../prisma'
import { assertTicketAccess, type Actor, type TicketAccess } from './board-access'
import { isTicketUuid, parseTicketDisplayId, parseTicketNumber, ticketDisplayId } from './ticket-id'
import type { TicketAuthorize } from './ticket-mutation'
import {
  childProgress,
  MAX_CHILD_ORDER,
  normalizeRelatedPair,
  RELATION_ALREADY_EXISTS,
  RELATION_TARGET_INVALID,
  type TicketRelationKind,
} from './ticket-relation-rule'

/**
 * 関係の相手を同じボードの中から引く。チケットID / 表示ID / 番号(`12` / `#12`)のいずれでも受ける。
 * 別ボード・存在しないものは区別せず RELATION_TARGET_INVALID にする(他ボードの存在を推測させない)
 */
export const resolveRelationTarget = async (tx: Db, boardId: string, raw: string): Promise<string> => {
  const value = raw.trim()
  const displayId = parseTicketDisplayId(value)
  const number = displayId ? displayId.number : parseTicketNumber(value)

  const where: Prisma.TicketWhereInput | null = isTicketUuid(value)
    ? { id: value, boardId }
    : number !== null
      ? { boardId, number, ...(displayId && { board: { key: displayId.key } }) }
      : null
  const ticket = where ? await tx.ticket.findFirst({ where, select: { id: true } }) : null
  if (!ticket) {
    throw errClient(RELATION_TARGET_INVALID)
  }
  return ticket.id
}

/**
 * チケット行のロック。子をロックして親の付け替えを直列にし(親が 2 つに増えない)、
 * 末尾の順番を採るときは親もロックして兄弟の同時追加で同じ順番が付かないようにする
 */
const lockTicket = async (tx: Prisma.TransactionClient, ticketId: string) => {
  await tx.$queryRaw`SELECT "id" FROM "ticket" WHERE "id" = ${ticketId} FOR UPDATE`
}

/** 親の下の末尾の順番(兄弟の最大 + 1)。子が居なければ 1。上限を超える場合は上限に揃える */
const nextChildOrder = async (tx: Prisma.TransactionClient, parentId: string): Promise<number> => {
  await lockTicket(tx, parentId)
  const max = await tx.ticketRelation.aggregate({
    where: { type: 'parent', fromId: parentId },
    _max: { order: true },
  })
  return Math.min((max._max.order ?? 0) + 1, MAX_CHILD_ORDER)
}

/**
 * 子の親を設定する(null で外す)。権限判定と相手の解決を済ませた後に同じトランザクション内で呼ぶ。
 * 親は 1 つだけなので、既存の親は置き換える。同じ親のままなら順番だけを変える(未指定なら据え置く)。
 */
export const writeTicketParent = async (
  tx: Prisma.TransactionClient,
  childId: string,
  parentId: string | null,
  order?: number,
): Promise<void> => {
  if (parentId === childId) {
    throw errClient(RELATION_TARGET_INVALID)
  }
  await lockTicket(tx, childId)

  const current = await tx.ticketRelation.findFirst({
    where: { type: 'parent', toId: childId },
    select: { id: true, fromId: true },
  })
  if (current && current.fromId === parentId) {
    if (order !== undefined) {
      await tx.ticketRelation.update({ where: { id: current.id }, data: { order } })
    }
    return
  }

  await tx.ticketRelation.deleteMany({ where: { type: 'parent', toId: childId } })
  if (parentId) {
    await tx.ticketRelation.create({
      data: { type: 'parent', fromId: parentId, toId: childId, order: order ?? (await nextChildOrder(tx, parentId)) },
    })
  }
}

/**
 * `parentId` の指定(チケットID / 表示ID / 番号、null で外す)を解決して親を設定する。
 * チケットの作成・更新(`ticket-mutation.ts`)から、権限判定を済ませた後に呼ぶ
 */
export const assignTicketParent = async (
  tx: Prisma.TransactionClient,
  ticket: { id: string; boardId: string },
  parent: string | null,
  order?: number,
): Promise<void> => {
  // 親を外すのに順番だけを渡されても意味が無いので、黙って捨てずに弾く
  if (parent === null && order !== undefined) {
    throw errInvalidOperation()
  }
  const parentId = parent === null ? null : await resolveRelationTarget(tx, ticket.boardId, parent)
  await writeTicketParent(tx, ticket.id, parentId, order)
}

/** 親の下での自分の順番を変える。親が無ければ throw する */
export const writeOwnChildOrder = async (tx: Prisma.TransactionClient, childId: string, order: number) => {
  const result = await tx.ticketRelation.updateMany({ where: { type: 'parent', toId: childId }, data: { order } })
  if (result.count === 0) {
    throw errInvalidOperation()
  }
}

export type AddTicketRelationInput = {
  ticketId: string
  /** 相手のチケットID / 表示ID / 番号 */
  target: string
  kind: TicketRelationKind
}

/**
 * 経路固有の追加制限(`TicketAuthorize`)を、関係で変わるチケットに掛ける。
 * 親子は子の属性(親)を変える扱いなので子だけ(`update_ticket` の parentId と同じ)、関連は向きが無いので両端に掛ける
 */
const authorizeRelation = async (
  tx: Prisma.TransactionClient,
  actor: Actor,
  relation: { type: TicketRelationType; fromId: string; toId: string },
  authorize: TicketAuthorize | undefined,
  /** 呼び出し側で判定済みのチケット。同じチケットを問い合わせ直さない */
  checked: TicketAccess,
) => {
  if (!authorize) {
    return
  }
  const ticketIds = relation.type === 'parent' ? [relation.toId] : [relation.fromId, relation.toId]
  for (const ticketId of ticketIds) {
    authorize(ticketId === checked.ticketId ? checked : await assertTicketAccess(actor, ticketId, 'edit', tx))
  }
}

/** 関係の追加(チケットを編集できる人)。親は置き換え、子と関連は既にあれば RELATION_ALREADY_EXISTS */
export const addTicketRelation = async (
  actor: Actor,
  { ticketId, target, kind }: AddTicketRelationInput,
  opts?: { authorize?: TicketAuthorize },
) =>
  prisma.$transaction(async (tx) => {
    const access = await assertTicketAccess(actor, ticketId, 'edit', tx)
    const targetId = await resolveRelationTarget(tx, access.boardId, target)
    if (targetId === ticketId) {
      throw errClient(RELATION_TARGET_INVALID)
    }

    const pair =
      kind === 'parent'
        ? { type: 'parent' as const, fromId: targetId, toId: ticketId }
        : kind === 'child'
          ? { type: 'parent' as const, fromId: ticketId, toId: targetId }
          : { type: 'related' as const, ...normalizeRelatedPair(ticketId, targetId) }
    await authorizeRelation(tx, actor, pair, opts?.authorize, access)
    const exists = await tx.ticketRelation.findUnique({ where: { type_fromId_toId: pair }, select: { id: true } })
    if (exists) {
      throw errClient(RELATION_ALREADY_EXISTS)
    }

    if (pair.type === 'parent') {
      await writeTicketParent(tx, pair.toId, pair.fromId)
    } else {
      // 関連はロックを取らないので、同じ組の同時追加は一意制約で弾かれる
      try {
        await tx.ticketRelation.create({ data: pair })
      } catch (error) {
        throw isUniqueViolation(error) ? errClient(RELATION_ALREADY_EXISTS) : error
      }
    }
    return { ticketId, targetId }
  })

/** 関係の削除(チケットを編集できる人)。どちら側のチケットから外しても同じ行が消える */
export const removeTicketRelation = async (actor: Actor, relationId: string, opts?: { authorize?: TicketAuthorize }) =>
  prisma.$transaction(async (tx) => {
    const relation = await tx.ticketRelation.findUnique({
      where: { id: relationId },
      select: { type: true, fromId: true, toId: true },
    })
    if (!relation) {
      throw errInvalidOperation()
    }
    const access = await assertTicketAccess(actor, relation.fromId, 'edit', tx)
    await authorizeRelation(tx, actor, relation, opts?.authorize, access)

    await tx.ticketRelation.delete({ where: { id: relationId } })
    return { id: relationId, ticketId: relation.fromId }
  })

/**
 * 子を兄弟の中で 1 つ前(-1) / 後(1)へ動かす(チケットを編集できる人)。
 * 並びは `listTicketRelations` と同じ(順番 → 番号)で、動かした後は兄弟全体を 1 からの連番に振り直す
 */
export const moveTicketChild = async (actor: Actor, relationId: string, offset: -1 | 1) =>
  prisma.$transaction(async (tx) => {
    const relation = await tx.ticketRelation.findUnique({
      where: { id: relationId },
      select: { type: true, fromId: true },
    })
    if (!relation || relation.type !== 'parent') {
      throw errInvalidOperation()
    }
    await assertTicketAccess(actor, relation.fromId, 'edit', tx)
    await lockTicket(tx, relation.fromId)

    const siblings = (
      await tx.ticketRelation.findMany({
        where: { type: 'parent', fromId: relation.fromId },
        select: { id: true, order: true, to: { select: { number: true } } },
      })
    ).sort((a, b) => a.order - b.order || a.to.number - b.to.number)
    const index = siblings.findIndex((sibling) => sibling.id === relationId)
    const target = index + offset
    if (index < 0 || target < 0 || target >= siblings.length) {
      return { id: relationId, ticketId: relation.fromId }
    }

    const [moved] = siblings.splice(index, 1)
    siblings.splice(target, 0, moved)
    for (const [i, sibling] of siblings.entries()) {
      const order = Math.min(i + 1, MAX_CHILD_ORDER)
      if (sibling.order !== order) {
        await tx.ticketRelation.update({ where: { id: sibling.id }, data: { order } })
      }
    }
    return { id: relationId, ticketId: relation.fromId }
  })

/** 関係の相手として返す項目 */
const relatedTicketSelect = {
  id: true,
  number: true,
  title: true,
  status: true,
  assignee: { select: { name: true } },
  board: { select: { key: true } },
} as const satisfies Prisma.TicketSelect

type RelatedTicketRow = Prisma.TicketGetPayload<{ select: typeof relatedTicketSelect }>

const toRelatedTicket = (relationId: string, { id, number, title, status, assignee, board }: RelatedTicketRow) => ({
  relationId,
  id,
  displayId: ticketDisplayId({ key: board.key, number }),
  title,
  status,
  assigneeName: assignee?.name ?? '',
})

/**
 * チケットの親・直下の子・関連を返す。参照は 1 階層だけ(孫や親の親は辿らない)。
 * 子は順番、同じ順番の中と関連は番号の昇順に並べる
 */
export const listTicketRelations = async (ticketId: string, tx: Db = prisma) => {
  const rows = await tx.ticketRelation.findMany({
    // 一意制約の索引は type が先頭なので、from 側も type を付けて索引に乗せる
    where: { OR: [{ type: { in: ['parent', 'related'] }, fromId: ticketId }, { toId: ticketId }] },
    select: {
      id: true,
      type: true,
      fromId: true,
      order: true,
      from: { select: relatedTicketSelect },
      to: { select: relatedTicketSelect },
    },
  })

  const parentRow = rows.find((row) => row.type === 'parent' && row.fromId !== ticketId)
  const children = rows
    .filter((row) => row.type === 'parent' && row.fromId === ticketId)
    .sort((a, b) => a.order - b.order || a.to.number - b.to.number)
    .map((row) => ({ ...toRelatedTicket(row.id, row.to), order: row.order }))
  const related = rows
    .filter((row) => row.type === 'related')
    .map((row) => toRelatedTicket(row.id, row.fromId === ticketId ? row.to : row.from))
    .sort((a, b) => a.displayId.localeCompare(b.displayId, undefined, { numeric: true }))

  return {
    parent: parentRow ? toRelatedTicket(parentRow.id, parentRow.from) : null,
    children,
    childProgress: childProgress(children.map((child) => child.status)),
    related,
  }
}
export type TicketRelations = Awaited<ReturnType<typeof listTicketRelations>>

/** 関係を見せない場合の空の値(ボードのメンバーでない承認者など) */
export const EMPTY_TICKET_RELATIONS: TicketRelations = {
  parent: null,
  children: [],
  childProgress: { done: 0, total: 0 },
  related: [],
}
