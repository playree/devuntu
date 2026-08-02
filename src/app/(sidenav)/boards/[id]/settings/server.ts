'use server'

import type { Prisma } from '@/generated/prisma/client'
import { safeAuthAction } from '@/lib/action-server'
import {
  assertBoardAccess,
  assertBoardAssignmentTargets,
  assertTeamBoard,
  countTicketsByBoard,
  getBoardMemberUsers,
  isAdminActor,
  syncBoardGroups,
  type Actor,
} from '@/lib/board'
import { errInvalidOperation } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import {
  scCreateTag,
  scRemoveBoardMember,
  scSetBoardGroups,
  scUpdateBoard,
  scUpdateTag,
  scUpsertBoardMember,
  scUUID,
} from '@/lib/schema'
import { listBoardTagsForManage, rethrowDuplicatedTagName } from '@/lib/tag'
import { canApplyAssignments, MAX_TAGS_PER_SCOPE, nextTagOrder, TICKET_STATUSES, type BoardRole } from '@/lib/task'

const TAG_SELECT = { id: true, boardId: true, name: true, color: true, order: true } as const

/**
 * ボード詳細(概要 + 権限)
 *
 * 権限は画面側のセクション表示に使う。クライアントの非表示だけに頼らず各 Action でも検証する。
 * メンバー一覧は独立してリロードできるよう getBoardMembers に分けている。
 */
export const getBoardDetail = safeAuthAction
  .metadata({ actionName: 'getBoardDetail', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    const access = await assertBoardAccess(user, id, 'view')

    const board = await prisma.board.findUnique({
      where: { id },
      select: { id: true, kind: true, name: true, description: true, archived: true, createdAt: true },
    })
    if (!board) {
      throw errInvalidOperation()
    }

    const counts = await countTicketsByBoard([id])
    const byStatus = counts[id] ?? {}

    return {
      ...board,
      description: board.description ?? '',
      role: access.role,
      via: access.via,
      // 権限境界: ユーザー単位のアサインは owner、グループ単位は管理者のみ
      canManage: access.role === 'owner' || isAdminActor(user),
      isAdmin: isAdminActor(user),
      ticketCounts: Object.fromEntries(TICKET_STATUSES.map((status) => [status, byStatus[status] ?? 0])),
    }
  })
export type GetBoardDetailReturnType = Awaited<ReturnType<typeof getBoardDetail>>['data']

/** メンバー一覧(グループ経由も含む)。閲覧はメンバーなら可能 */
export const getBoardMembers = safeAuthAction
  .metadata({ actionName: 'getBoardMembers', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await assertBoardAccess(user, id, 'view')
    return getBoardMemberUsers(id)
  })
export type GetBoardMembersReturnType = Awaited<ReturnType<typeof getBoardMembers>>['data']

/** ボード更新(owner または管理者)。プライベートボードは変更できない */
export const updateBoard = safeAuthAction
  .metadata({ actionName: 'updateBoard', role: 'user' })
  .inputSchema(scUpdateBoard)
  .action(async ({ ctx: { user }, parsedInput: { id, name, description, archived } }) => {
    const board = await prisma.$transaction(async (tx) => {
      await assertBoardAccess(user, id, 'manage', tx)
      await assertTeamBoard(tx, id)

      return tx.board.update({ where: { id }, data: { name, description, archived }, select: { id: true, name: true } })
    })

    logger.info({ userId: user.id, id }, 'board updated')
    return board
  })

/** ボード削除(owner または管理者)。チケット / タグ / アサインは Cascade で消える */
export const deleteBoard = safeAuthAction
  .metadata({ actionName: 'deleteBoard', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await prisma.$transaction(async (tx) => {
      await assertBoardAccess(user, id, 'manage', tx)
      await assertTeamBoard(tx, id)
      await tx.board.delete({ where: { id } })
    })

    logger.info({ userId: user.id, id }, 'board deleted')
    return { id }
  })

/* -------------------------------------------------------------------------------------------------
 * アサイン
 * -----------------------------------------------------------------------------------------------*/

/** アサイン編集フォームの初期値(直接メンバー + グループ + 選択肢) */
export const getBoardAssignments = safeAuthAction
  .metadata({ actionName: 'getBoardAssignments', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await assertBoardAccess(user, id, 'manage')

    const [board, users, groups] = await Promise.all([
      prisma.board.findUnique({
        where: { id },
        select: {
          members: { select: { userId: true, role: true } },
          groups: { select: { groupId: true } },
        },
      }),
      prisma.user.findMany({ select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }),
      prisma.group.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ])
    if (!board) {
      throw errInvalidOperation()
    }

    return {
      ownerIds: board.members.filter((m) => m.role === 'owner').map((m) => m.userId),
      memberIds: board.members.filter((m) => m.role === 'member').map((m) => m.userId),
      groupIds: board.groups.map((g) => g.groupId),
      userOptions: Object.fromEntries(users.map((u) => [u.id, `${u.name} (${u.email})`])) as Record<string, string>,
      groupOptions: Object.fromEntries(groups.map((g) => [g.id, g.name])) as Record<string, string>,
    }
  })
export type GetBoardAssignmentsReturnType = Awaited<ReturnType<typeof getBoardAssignments>>['data']

/**
 * 操作後に owner が 1 人以上残るかを検証する。0 人になるとボードが管理不能になるため。
 * `nextRole` が null は対象ユーザーの削除。管理者は 0 人にできる(/admin から救済できる)。
 */
const assertOwnerRemains = async (
  tx: Prisma.TransactionClient,
  { actor, boardId, userId, nextRole }: { actor: Actor; boardId: string; userId: string; nextRole: BoardRole | null },
): Promise<void> => {
  const owners = await tx.boardMember.findMany({ where: { boardId, role: 'owner' }, select: { userId: true } })
  const ownerIds = owners.map((owner) => owner.userId).filter((id) => id !== userId)
  if (nextRole === 'owner') {
    ownerIds.push(userId)
  }

  if (!canApplyAssignments({ ownerIds, byAdmin: isAdminActor(actor) })) {
    throw errInvalidOperation()
  }
}

/**
 * 直接メンバー(BoardMember)1 行を追加 / 更新する。追加と編集で処理が同じなので実体を共有する。
 * グループ経由メンバーへのロール付与もここを通る(行が無ければ create される)。
 *
 * 呼び出し側でトランザクションを張ること。
 */
const upsertBoardMember = async (
  tx: Prisma.TransactionClient,
  { actor, boardId, userId, role }: { actor: Actor; boardId: string; userId: string; role: BoardRole },
): Promise<void> => {
  await assertBoardAccess(actor, boardId, 'manage', tx)
  await assertTeamBoard(tx, boardId)
  await assertBoardAssignmentTargets(tx, { userIds: [userId], groupIds: [] })
  await assertOwnerRemains(tx, { actor, boardId, userId, nextRole: role })

  await tx.boardMember.upsert({
    where: { boardId_userId: { boardId, userId } },
    create: { boardId, userId, role },
    update: { role },
  })
}

/** メンバーを 1 人追加する(owner または管理者)。既に直接メンバーならロールを上書きする */
export const addBoardMember = safeAuthAction
  .metadata({ actionName: 'addBoardMember', role: 'user' })
  .inputSchema(scUpsertBoardMember)
  .action(async ({ ctx: { user }, parsedInput: { id, userId, role } }) => {
    await prisma.$transaction((tx) => upsertBoardMember(tx, { actor: user, boardId: id, userId, role }))

    logger.info({ userId: user.id, id, targetId: userId, role }, 'board member added')
    return { id }
  })

/**
 * メンバーのロールを変更する(owner または管理者)。
 * グループ経由メンバーもここで直接ロールを付与できる(付与後は via='member' になる)。
 */
export const updateBoardMemberRole = safeAuthAction
  .metadata({ actionName: 'updateBoardMemberRole', role: 'user' })
  .inputSchema(scUpsertBoardMember)
  .action(async ({ ctx: { user }, parsedInput: { id, userId, role } }) => {
    await prisma.$transaction((tx) => upsertBoardMember(tx, { actor: user, boardId: id, userId, role }))

    logger.info({ userId: user.id, id, targetId: userId, role }, 'board member role updated')
    return { id }
  })

/**
 * 直接メンバーを外す(owner または管理者)。
 * グループ経由メンバーは BoardMember 行を持たないため対象外(ボードグループ設定で外す)。
 */
export const removeBoardMember = safeAuthAction
  .metadata({ actionName: 'removeBoardMember', role: 'user' })
  .inputSchema(scRemoveBoardMember)
  .action(async ({ ctx: { user }, parsedInput: { id, userId } }) => {
    await prisma.$transaction(async (tx) => {
      await assertBoardAccess(user, id, 'manage', tx)
      await assertTeamBoard(tx, id)

      const member = await tx.boardMember.findUnique({
        where: { boardId_userId: { boardId: id, userId } },
        select: { id: true },
      })
      if (!member) {
        throw errInvalidOperation()
      }

      await assertOwnerRemains(tx, { actor: user, boardId: id, userId, nextRole: null })
      await tx.boardMember.delete({ where: { id: member.id } })
    })

    logger.info({ userId: user.id, id, targetId: userId }, 'board member removed')
    return { id }
  })

/** グループ単位のアサインを更新する(管理者のみ) */
export const setBoardGroups = safeAuthAction
  .metadata({ actionName: 'setBoardGroups', role: 'user' })
  .inputSchema(scSetBoardGroups)
  .action(async ({ ctx: { user }, parsedInput: { id, groupIds } }) => {
    // ボードの owner でも変更させない
    if (!isAdminActor(user)) {
      throw errInvalidOperation()
    }

    await prisma.$transaction(async (tx) => {
      await assertBoardAccess(user, id, 'manage', tx)
      await assertTeamBoard(tx, id)
      await assertBoardAssignmentTargets(tx, { userIds: [], groupIds })
      await syncBoardGroups(tx, id, groupIds)
    })

    logger.info({ userId: user.id, id }, 'board groups updated')
    return { id }
  })

/* -------------------------------------------------------------------------------------------------
 * タグ
 * -----------------------------------------------------------------------------------------------*/

/** ボードのタグ一覧(使用件数付き)。閲覧はメンバーなら可能 */
export const getBoardTags = safeAuthAction
  .metadata({ actionName: 'getBoardTags', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await assertBoardAccess(user, id, 'view')
    return listBoardTagsForManage(id)
  })
export type GetBoardTagsReturnType = Awaited<ReturnType<typeof getBoardTags>>['data']

/** タグ作成。チケット編集中にも必要になるためメンバー権限で実行できる */
export const createBoardTag = safeAuthAction
  .metadata({ actionName: 'createBoardTag', role: 'user' })
  .inputSchema(scCreateTag)
  .action(async ({ ctx: { user }, parsedInput: { boardId, name, color, order } }) => {
    await assertBoardAccess(user, boardId, 'view')

    const tags = await prisma.tag.findMany({ where: { boardId }, select: { order: true } })
    if (tags.length >= MAX_TAGS_PER_SCOPE) {
      throw errInvalidOperation()
    }

    const tag = await prisma.tag
      .create({
        data: { boardId, name, color, order: order || nextTagOrder(tags.map((row) => row.order)) },
        select: TAG_SELECT,
      })
      .catch(rethrowDuplicatedTagName)

    logger.info({ userId: user.id, tag }, 'tag created')
    return tag
  })

/** タグ更新(リネーム / 色 / 表示順)。owner または管理者 */
export const updateBoardTag = safeAuthAction
  .metadata({ actionName: 'updateBoardTag', role: 'user' })
  .inputSchema(scUpdateTag)
  .action(async ({ ctx: { user }, parsedInput: { id, name, color, order } }) => {
    const target = await prisma.tag.findUnique({ where: { id }, select: { boardId: true } })
    if (!target) {
      throw errInvalidOperation()
    }
    await assertBoardAccess(user, target.boardId, 'manage')

    const tag = await prisma.tag
      .update({ where: { id }, data: { name, color, order }, select: TAG_SELECT })
      .catch(rethrowDuplicatedTagName)

    logger.info({ userId: user.id, id }, 'tag updated')
    return tag
  })

/** タグ削除(owner または管理者)。TicketTag は Cascade で消える */
export const deleteBoardTag = safeAuthAction
  .metadata({ actionName: 'deleteBoardTag', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await prisma.$transaction(async (tx) => {
      const target = await tx.tag.findUnique({ where: { id }, select: { boardId: true } })
      if (!target) {
        throw errInvalidOperation()
      }
      await assertBoardAccess(user, target.boardId, 'manage', tx)
      await tx.tag.delete({ where: { id } })
    })

    logger.info({ userId: user.id, id }, 'tag deleted')
    return { id }
  })
