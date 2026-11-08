/**
 * Wiki スペースの割り当て(ユーザー / グループ / ボード)の読み書き(サーバー専用)
 *
 * `/wiki/[key]/settings` の Server Action から呼ぶ。どの操作も manage(owner または管理者)を要求する。
 * owner はユーザーの直接割り当てに限り、グループ・ボードは viewer / editor だけを持つ。
 */

import type { WikiAssignRole, WikiSpaceRole } from '@/generated/prisma/enums'
import type { BoardWhereInput } from '@/generated/prisma/models'
import { isAdminActor, type Actor } from '../board/board-access'
import { BOARD_USER_SELECT } from '../board/board-member'
import { boardVisibleWhere, canApplyAssignments } from '../board/ticket-permission'
import { ClientError, errInvalidOperation } from '../error'
import { listGroupOptions } from '../group'
import { logger } from '../logger'
import { prisma, type Db } from '../prisma'
import { assertWikiSpaceAccess } from './wiki-access'
import { WIKI_SPACE_NO_OWNER } from './wiki-rule'

const errNoOwner = () =>
  new ClientError(WIKI_SPACE_NO_OWNER, 'A wiki space needs at least one owner. Assign another owner first')

/** 割り当ての数え上げから更新までを、同じスペースへの他の割り当て変更と直列にする */
const lockSpaceRow = async (tx: Db, spaceId: string) => {
  await tx.$queryRaw`SELECT "id" FROM "wiki_space" WHERE "id" = ${spaceId} FOR NO KEY UPDATE`
}

/**
 * 割り当てられるボード。チームボードのうち、操作者が見えるもの(管理者はすべて)。
 * 見えないボードを割り当てると、そのボードのメンバーへ本文を見せる経路を作れてしまうため
 */
const assignableBoardWhere = (actor: Actor): BoardWhereInput => ({
  kind: 'team',
  archived: false,
  ...(isAdminActor(actor) ? {} : { AND: [boardVisibleWhere(actor.id)] }),
})

/** 割り当ての一覧(直接メンバー / グループ / ボード) */
export const getWikiSpaceAssignments = async (actor: Actor, spaceId: string) => {
  await assertWikiSpaceAccess(actor, spaceId, 'manage')
  const space = await prisma.wikiSpace.findUnique({
    where: { id: spaceId },
    select: {
      members: { select: { role: true, user: { select: BOARD_USER_SELECT } } },
      groups: { select: { role: true, group: { select: { id: true, name: true } } } },
      boards: { select: { role: true, board: { select: { id: true, name: true, key: true } } } },
    },
  })
  if (!space) {
    throw errInvalidOperation()
  }
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)
  return {
    members: space.members.map(({ role, user }) => ({ ...user, role })).sort(byName),
    groups: space.groups.map(({ role, group }) => ({ ...group, role })).sort(byName),
    boards: space.boards.map(({ role, board }) => ({ ...board, role })).sort(byName),
  }
}

/** 割り当ての候補(全ユーザー / 全グループ / 割り当てられるボード) */
export const getWikiSpaceAssignOptions = async (actor: Actor, spaceId: string) => {
  await assertWikiSpaceAccess(actor, spaceId, 'manage')
  const [users, groupOptions, boards] = await Promise.all([
    prisma.user.findMany({ select: BOARD_USER_SELECT, orderBy: { name: 'asc' } }),
    listGroupOptions(),
    prisma.board.findMany({
      where: assignableBoardWhere(actor),
      select: { id: true, name: true, key: true },
      orderBy: { name: 'asc' },
    }),
  ])
  return {
    userOptions: users, // 構造は `components/user-select.tsx` の UserSelectOption と一致させること
    groupOptions,
    boardOptions: Object.fromEntries(boards.map((board) => [board.id, `${board.name} (${board.key})`])),
  }
}

/** 操作後に直接割り当ての owner が残るか。管理者は 0 人にできる(管理画面と同じく、管理者が救済できるため) */
const assertOwnerRemains = async (
  tx: Db,
  {
    actor,
    spaceId,
    userId,
    nextRole,
  }: { actor: Actor; spaceId: string; userId: string; nextRole: WikiSpaceRole | null },
) => {
  const owners = await tx.wikiSpaceMember.findMany({ where: { spaceId, role: 'owner' }, select: { userId: true } })
  const ownerIds = owners.map((owner) => owner.userId).filter((id) => id !== userId)
  if (nextRole === 'owner') {
    ownerIds.push(userId)
  }
  if (!canApplyAssignments({ ownerIds, byAdmin: isAdminActor(actor) })) {
    throw errNoOwner()
  }
}

/** ユーザーを直接割り当てる / ロールを変える。既に割り当て済みならロールを上書きする */
export const upsertWikiSpaceMember = async (
  actor: Actor,
  { spaceId, userId, role }: { spaceId: string; userId: string; role: WikiSpaceRole },
) => {
  await prisma.$transaction(async (tx) => {
    await lockSpaceRow(tx, spaceId)
    await assertWikiSpaceAccess(actor, spaceId, 'manage', tx)
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!user) {
      throw errInvalidOperation()
    }
    await assertOwnerRemains(tx, { actor, spaceId, userId, nextRole: role })
    await tx.wikiSpaceMember.upsert({
      where: { spaceId_userId: { spaceId, userId } },
      create: { spaceId, userId, role },
      update: { role },
    })
  })
  logger.info({ userId: actor.id, spaceId, targetId: userId, role }, 'wiki space member assigned')
}

/** ユーザーの直接割り当てを外す */
export const removeWikiSpaceMember = async (actor: Actor, { spaceId, userId }: { spaceId: string; userId: string }) => {
  await prisma.$transaction(async (tx) => {
    await lockSpaceRow(tx, spaceId)
    await assertWikiSpaceAccess(actor, spaceId, 'manage', tx)
    const member = await tx.wikiSpaceMember.findUnique({
      where: { spaceId_userId: { spaceId, userId } },
      select: { id: true },
    })
    if (!member) {
      throw errInvalidOperation()
    }
    await assertOwnerRemains(tx, { actor, spaceId, userId, nextRole: null })
    await tx.wikiSpaceMember.delete({ where: { id: member.id } })
  })
  logger.info({ userId: actor.id, spaceId, targetId: userId }, 'wiki space member removed')
}

/** グループを割り当てる / ロールを変える */
export const upsertWikiSpaceGroup = async (
  actor: Actor,
  { spaceId, groupId, role }: { spaceId: string; groupId: string; role: WikiAssignRole },
) => {
  await prisma.$transaction(async (tx) => {
    await assertWikiSpaceAccess(actor, spaceId, 'manage', tx)
    const group = await tx.group.findUnique({ where: { id: groupId }, select: { id: true } })
    if (!group) {
      throw errInvalidOperation()
    }
    await tx.wikiSpaceGroup.upsert({
      where: { spaceId_groupId: { spaceId, groupId } },
      create: { spaceId, groupId, role },
      update: { role },
    })
  })
  logger.info({ userId: actor.id, spaceId, groupId, role }, 'wiki space group assigned')
}

/** グループの割り当てを外す */
export const removeWikiSpaceGroup = async (
  actor: Actor,
  { spaceId, groupId }: { spaceId: string; groupId: string },
) => {
  await prisma.$transaction(async (tx) => {
    await assertWikiSpaceAccess(actor, spaceId, 'manage', tx)
    const { count } = await tx.wikiSpaceGroup.deleteMany({ where: { spaceId, groupId } })
    if (count === 0) {
      throw errInvalidOperation()
    }
  })
  logger.info({ userId: actor.id, spaceId, groupId }, 'wiki space group removed')
}

/**
 * ボードを割り当てる / ロールを変える。
 * 新しく割り当てるボードは候補(assignableBoardWhere)に限る。割り当て済みのロール変更は、
 * 操作者がそのボードを見られなくなっていても許す(外すこともできるので)
 */
export const upsertWikiSpaceBoard = async (
  actor: Actor,
  { spaceId, boardId, role }: { spaceId: string; boardId: string; role: WikiAssignRole },
) => {
  await prisma.$transaction(async (tx) => {
    await assertWikiSpaceAccess(actor, spaceId, 'manage', tx)
    const [assigned, board] = await Promise.all([
      tx.wikiSpaceBoard.findUnique({ where: { spaceId_boardId: { spaceId, boardId } }, select: { id: true } }),
      tx.board.findFirst({ where: { id: boardId, ...assignableBoardWhere(actor) }, select: { id: true } }),
    ])
    if (!assigned && !board) {
      throw errInvalidOperation()
    }
    await tx.wikiSpaceBoard.upsert({
      where: { spaceId_boardId: { spaceId, boardId } },
      create: { spaceId, boardId, role },
      update: { role },
    })
  })
  logger.info({ userId: actor.id, spaceId, boardId, role }, 'wiki space board assigned')
}

/** ボードの割り当てを外す */
export const removeWikiSpaceBoard = async (
  actor: Actor,
  { spaceId, boardId }: { spaceId: string; boardId: string },
) => {
  await prisma.$transaction(async (tx) => {
    await assertWikiSpaceAccess(actor, spaceId, 'manage', tx)
    const { count } = await tx.wikiSpaceBoard.deleteMany({ where: { spaceId, boardId } })
    if (count === 0) {
      throw errInvalidOperation()
    }
  })
  logger.info({ userId: actor.id, spaceId, boardId }, 'wiki space board removed')
}
