/**
 * チケットテンプレートの参照・更新(サーバー専用)
 *
 * 閲覧はボードのメンバー、追加・編集・削除は owner と管理者(プライベートボードは所有者のみ)。
 * 純粋関数と定数は `ticket-template-rule.ts` を参照。
 */

import type { TicketPriority } from '@/generated/prisma/enums'
import { errClient, errInvalidOperation } from '../error'
import { logger } from '../logger'
import { isUniqueViolation, prisma, type Db } from '../prisma'
import type { CreateTicketTemplate, UpdateTicketTemplate } from '../schema/schema-ticket-template'
import { assertBoardAccess, type Actor } from './board-access'
import { assertBoardContentManageable } from './board-setting'
import { assertTagIdsInBoard } from './tag'
import {
  DUPLICATED_TEMPLATE_NAME,
  filterTemplateTagIds,
  MAX_TEMPLATES_PER_BOARD,
  type TicketTemplateValues,
} from './ticket-template-rule'

export type TicketTemplateItem = TicketTemplateValues & { id: string; name: string }

const TEMPLATE_SELECT = {
  id: true,
  name: true,
  content: true,
  criteria: true,
  tagIds: true,
  priority: true,
} as const

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const rethrowDuplicatedTemplateName = (e: unknown): never => {
  if (isUniqueViolation(e)) {
    throw errClient(DUPLICATED_TEMPLATE_NAME)
  }
  throw e
}

type TemplateRow = {
  id: string
  name: string
  content: string
  criteria: string[]
  tagIds: string[]
  priority: TicketPriority | null
}

const withExistingTags = async (tx: Db, boardId: string, rows: TemplateRow[]): Promise<TicketTemplateItem[]> => {
  if (rows.length === 0) {
    return []
  }
  const tags = await tx.tag.findMany({ where: { boardId }, select: { id: true } })
  const boardTagIds = tags.map((tag) => tag.id)
  return rows.map((row) => ({ ...row, tagIds: filterTemplateTagIds(row.tagIds, boardTagIds) }))
}

/** ボードのテンプレート一覧(名前順)。認可は呼び出し側で通すこと */
export const listTicketTemplates = async (boardId: string, tx: Db = prisma): Promise<TicketTemplateItem[]> => {
  const rows = await tx.ticketTemplate.findMany({
    where: { boardId },
    select: TEMPLATE_SELECT,
    orderBy: { name: 'asc' },
  })
  return withExistingTags(tx, boardId, rows)
}

/** 画面向けのテンプレート一覧(ボードのメンバーなら閲覧できる) */
export const listBoardTicketTemplates = async (actor: Actor, boardId: string): Promise<TicketTemplateItem[]> => {
  await assertBoardAccess(actor, boardId, 'view')
  return listTicketTemplates(boardId)
}

/**
 * ID または名前でテンプレートを引く(MCP の create_ticket)。他ボードのテンプレートは指定できない。
 * 見つからなければ errInvalidOperation()
 */
export const findTicketTemplate = async (
  boardId: string,
  idOrName: string,
  tx: Db = prisma,
): Promise<TicketTemplateItem> => {
  const row = await tx.ticketTemplate.findFirst({
    where: { boardId, ...(UUID_PATTERN.test(idOrName) ? { id: idOrName } : { name: idOrName.trim() }) },
    select: TEMPLATE_SELECT,
  })
  if (!row) {
    throw errInvalidOperation()
  }
  const [template] = await withExistingTags(tx, boardId, [row])
  return template
}

/** テンプレートの追加。ボード行をロックしてから件数を数え、同時作成で上限を超えないようにする */
export const createTicketTemplate = async (actor: Actor, { boardId, tagIds, ...fields }: CreateTicketTemplate) => {
  const template = await prisma
    .$transaction(async (tx) => {
      await assertBoardContentManageable(actor, boardId, tx)
      await tx.$queryRaw`SELECT "id" FROM "board" WHERE "id" = ${boardId} FOR UPDATE`
      const count = await tx.ticketTemplate.count({ where: { boardId } })
      if (count >= MAX_TEMPLATES_PER_BOARD) {
        throw errInvalidOperation()
      }
      const ids = await assertTagIdsInBoard(tx, boardId, tagIds)
      return tx.ticketTemplate.create({
        data: { boardId, ...fields, tagIds: ids },
        select: { id: true, name: true },
      })
    })
    .catch(rethrowDuplicatedTemplateName)

  logger.info({ userId: actor.id, boardId, template }, 'ticket template created')
  return template
}

export const updateTicketTemplate = async (actor: Actor, { id, tagIds, ...fields }: UpdateTicketTemplate) => {
  const template = await prisma
    .$transaction(async (tx) => {
      const target = await tx.ticketTemplate.findUnique({ where: { id }, select: { boardId: true } })
      if (!target) {
        throw errInvalidOperation()
      }
      await assertBoardContentManageable(actor, target.boardId, tx)
      const ids = await assertTagIdsInBoard(tx, target.boardId, tagIds)
      return tx.ticketTemplate.update({
        where: { id },
        data: { ...fields, tagIds: ids },
        select: { id: true, name: true },
      })
    })
    .catch(rethrowDuplicatedTemplateName)

  logger.info({ userId: actor.id, id }, 'ticket template updated')
  return template
}

export const deleteTicketTemplate = async (actor: Actor, id: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const target = await tx.ticketTemplate.findUnique({ where: { id }, select: { boardId: true } })
    if (!target) {
      throw errInvalidOperation()
    }
    await assertBoardContentManageable(actor, target.boardId, tx)
    await tx.ticketTemplate.delete({ where: { id } })
  })

  logger.info({ userId: actor.id, id }, 'ticket template deleted')
}
