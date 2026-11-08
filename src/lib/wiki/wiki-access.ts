/**
 * Wiki スペースの認可判定(サーバー専用)
 *
 * prisma に依存するため、クライアントからは import しないこと(純粋な判定は `wiki-rule.ts`)。
 * Wiki の Server Action / MCP はスペース単位の認可を `assertWikiSpaceAccess` に通す。
 */

import type { WikiVisibility } from '@/generated/prisma/enums'
import type { WikiSpaceWhereInput } from '@/generated/prisma/models'
import { isAdminActor, type Actor } from '../board/board-access'
import { boardVisibleWhere } from '../board/ticket-permission'
import { errInvalidOperation } from '../error'
import { prisma, type Db } from '../prisma'
import { evaluateWikiAccess, resolveWikiRole, type WikiPermission, type WikiRole } from './wiki-rule'

export type WikiSpaceAccess = WikiPermission & {
  spaceId: string
  key: string
  /** 実効ロール。管理者が割り当て無しで管理操作をするときは null */
  role: WikiRole | null
  visibility: WikiVisibility
  archived: boolean
}

/** `userId` が閲覧できるスペースの条件(割り当て・グループ・ボード経由・everyone) */
export const wikiSpaceVisibleWhere = (userId: string): WikiSpaceWhereInput => ({
  OR: [
    { visibility: 'everyone' },
    { members: { some: { userId } } },
    { groups: { some: { group: { userGroups: { some: { userId } } } } } },
    { boards: { some: { board: boardVisibleWhere(userId) } } },
  ],
})

/** 一覧・検索のスコープ。既定はアーカイブ済みを除く */
export const wikiSpaceListWhere = (userId: string, opts?: { includeArchived?: boolean }): WikiSpaceWhereInput => ({
  ...(opts?.includeArchived ? {} : { archived: false }),
  ...wikiSpaceVisibleWhere(userId),
})

/** 実効ロールの解決に要る割り当てだけを、`userId` に関係する行に絞って引く */
export const wikiRoleSelect = (userId: string) =>
  ({
    visibility: true,
    members: { where: { userId }, select: { role: true }, take: 1 },
    groups: { where: { group: { userGroups: { some: { userId } } } }, select: { role: true } },
    boards: { where: { board: boardVisibleWhere(userId) }, select: { role: true } },
  }) as const

export type WikiRoleRow = {
  visibility: WikiVisibility
  members: { role: WikiRole }[]
  groups: { role: WikiRole }[]
  boards: { role: WikiRole }[]
}

export const roleOfWikiRow = (row: WikiRoleRow): WikiRole | null =>
  resolveWikiRole({
    direct: row.members[0]?.role ?? null,
    groups: row.groups.map(({ role }) => role),
    boards: row.boards.map(({ role }) => role),
    everyone: row.visibility === 'everyone',
  })

/** スペースの権限。スペースが無ければ null(割り当てが無くても、管理者なら canManage だけを持つ値を返す) */
export const getWikiSpaceAccess = async (
  actor: Actor,
  spaceId: string,
  tx: Db = prisma,
): Promise<WikiSpaceAccess | null> => {
  const space = await tx.wikiSpace.findUnique({
    where: { id: spaceId },
    select: { id: true, key: true, archived: true, ...wikiRoleSelect(actor.id) },
  })
  if (!space) {
    return null
  }
  const role = roleOfWikiRow(space)
  return {
    spaceId: space.id,
    key: space.key,
    role,
    visibility: space.visibility,
    archived: space.archived,
    ...evaluateWikiAccess({ role, archived: space.archived, isAdmin: isAdminActor(actor) }),
  }
}

/**
 * スペースへのアクセスを検証する。NG・未存在は errInvalidOperation() を throw。
 * - view   : viewer 以上(everyone のスペースは全ログインユーザー)
 * - write  : editor 以上 かつ 未アーカイブ
 * - manage : owner または管理者
 */
export const assertWikiSpaceAccess = async (
  actor: Actor,
  spaceId: string,
  need: 'view' | 'write' | 'manage',
  tx: Db = prisma,
): Promise<WikiSpaceAccess> => {
  const access = await getWikiSpaceAccess(actor, spaceId, tx)
  const allowed = access && { view: access.canView, write: access.canWrite, manage: access.canManage }[need]
  if (!allowed) {
    throw errInvalidOperation()
  }
  return access
}

/** 指定ユーザーが閲覧できるスペースの ID(検索・索引のスコープに使う) */
export const getAccessibleWikiSpaceIds = async (
  userId: string,
  opts?: { includeArchived?: boolean },
  tx: Db = prisma,
): Promise<string[]> => {
  const spaces = await tx.wikiSpace.findMany({
    where: wikiSpaceListWhere(userId, opts),
    select: { id: true },
  })
  return spaces.map(({ id }) => id)
}
