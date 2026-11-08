/**
 * Wiki スペースの作成・更新・一覧(サーバー専用)
 *
 * スペースはログインユーザーなら誰でも作れ、作成者が owner になる。
 * 設定の変更(名前・説明・公開範囲・アーカイブ)は owner と管理者。割り当ての変更は画面側のチケットで扱う。
 */

import type { WikiVisibility } from '@/generated/prisma/enums'
import { isAdminActor, type Actor } from '../board/board-access'
import { ClientError, errInvalidOperation, errValidation } from '../error'
import { logger } from '../logger'
import { isUniqueViolation, prisma } from '../prisma'
import { assertWikiSpaceAccess, roleOfWikiRow, wikiRoleSelect, wikiSpaceListWhere } from './wiki-access'
import {
  DUPLICATED_WIKI_SPACE_KEY,
  evaluateWikiAccess,
  MAX_WIKI_SPACE_DESCRIPTION,
  MAX_WIKI_SPACE_NAME,
  WIKI_SPACE_KEY_PATTERN,
} from './wiki-rule'

export type WikiSpaceInput = {
  key: string
  name: string
  description?: string | null
  visibility?: WikiVisibility
}

const errDuplicatedKey = () =>
  new ClientError(DUPLICATED_WIKI_SPACE_KEY, 'A wiki space with this key already exists. Choose another key')

const assertName = (name: string) => {
  if (name.trim() === '' || name.length > MAX_WIKI_SPACE_NAME) {
    throw errValidation(`name must be 1 to ${MAX_WIKI_SPACE_NAME} characters`)
  }
}

const assertDescription = (description: string | null | undefined) => {
  if (description && description.length > MAX_WIKI_SPACE_DESCRIPTION) {
    throw errValidation(`description must be at most ${MAX_WIKI_SPACE_DESCRIPTION} characters`)
  }
}

const SPACE_SELECT = {
  id: true,
  key: true,
  name: true,
  description: true,
  visibility: true,
  archived: true,
  createdAt: true,
  updatedAt: true,
} as const

/** スペースを作り、作成者を owner として割り当てる */
export const createWikiSpace = async (actor: Actor, input: WikiSpaceInput) => {
  const key = input.key.trim().toUpperCase()
  if (!WIKI_SPACE_KEY_PATTERN.test(key)) {
    throw errValidation('key must be 2 to 8 uppercase letters or digits starting with a letter')
  }
  assertName(input.name)
  assertDescription(input.description)

  const space = await prisma.wikiSpace
    .create({
      data: {
        key,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        visibility: input.visibility ?? 'restricted',
        members: { create: { userId: actor.id, role: 'owner' } },
      },
      select: SPACE_SELECT,
    })
    .catch((e: unknown) => {
      throw isUniqueViolation(e) ? errDuplicatedKey() : e
    })

  logger.info({ userId: actor.id, spaceId: space.id, key }, 'wiki space created')
  return space
}

/** 名前・説明・公開範囲の変更。undefined の項目はそのまま残す */
export const updateWikiSpace = async (actor: Actor, spaceId: string, patch: Partial<Omit<WikiSpaceInput, 'key'>>) => {
  if (patch.name !== undefined) {
    assertName(patch.name)
  }
  assertDescription(patch.description)
  await assertWikiSpaceAccess(actor, spaceId, 'manage')
  const space = await prisma.wikiSpace.update({
    where: { id: spaceId },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
      ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
    },
    select: SPACE_SELECT,
  })
  logger.info({ userId: actor.id, spaceId }, 'wiki space updated')
  return space
}

/** アーカイブの切り替え。アーカイブ済みは閲覧のみになる */
export const setWikiSpaceArchived = async (actor: Actor, spaceId: string, archived: boolean) => {
  await assertWikiSpaceAccess(actor, spaceId, 'manage')
  await prisma.wikiSpace.update({ where: { id: spaceId }, data: { archived }, select: { id: true } })
  logger.info({ userId: actor.id, spaceId, archived }, 'wiki space archived changed')
}

/** 閲覧できるスペースの一覧(名前順)と、それぞれでの自分の権限 */
export const listWikiSpaces = async (actor: Actor, opts?: { includeArchived?: boolean }) => {
  const spaces = await prisma.wikiSpace.findMany({
    where: wikiSpaceListWhere(actor.id, opts),
    select: { ...SPACE_SELECT, ...wikiRoleSelect(actor.id) },
    orderBy: [{ name: 'asc' }, { key: 'asc' }],
  })
  return spaces.map(({ members, groups, boards, ...space }) => {
    const role = roleOfWikiRow({ visibility: space.visibility, members, groups, boards })
    return { ...space, role, ...evaluateWikiAccess({ role, archived: space.archived, isAdmin: isAdminActor(actor) }) }
  })
}

export type WikiSpaceSummary = Awaited<ReturnType<typeof listWikiSpaces>>[number]

/** キーでスペースを引く(閲覧できなければ errInvalidOperation) */
export const getWikiSpaceByKey = async (actor: Actor, key: string) => {
  const space = await prisma.wikiSpace.findUnique({ where: { key: key.toUpperCase() }, select: SPACE_SELECT })
  if (!space) {
    throw errInvalidOperation()
  }
  const access = await assertWikiSpaceAccess(actor, space.id, 'view')
  return { space, access }
}
