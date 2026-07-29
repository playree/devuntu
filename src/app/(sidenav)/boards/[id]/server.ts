'use server'

import { safeAuthAction } from '@/lib/action-server'
import {
  assertBoardAccess,
  assertBoardAssignmentTargets,
  assertTeamBoard,
  countTicketsByBoard,
  getBoardMemberUsers,
  isAdminActor,
  syncBoardGroups,
  syncBoardMembers,
} from '@/lib/board'
import { errInvalidOperation } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scCreateTag, scMergeTags, scSetBoardGroups, scSetBoardMembers, scUpdateTag, scUUID } from '@/lib/schema'
import { listBoardTagsForManage, mergeTags, rethrowDuplicatedTagName } from '@/lib/tag'
import { canApplyAssignments, MAX_TAGS_PER_SCOPE, mergeBoardMembers, nextTagOrder, TICKET_STATUSES } from '@/lib/task'

const TAG_SELECT = { id: true, boardId: true, name: true, color: true, order: true } as const

/**
 * ボード詳細(概要 + メンバー + 権限)
 *
 * 権限は画面側のセクション表示に使う。クライアントの非表示だけに頼らず各 Action でも検証する。
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

    const [members, counts] = await Promise.all([getBoardMemberUsers(id), countTicketsByBoard([id])])
    const byStatus = counts[id] ?? {}

    return {
      ...board,
      description: board.description ?? '',
      role: access.role,
      via: access.via,
      // 権限境界: ユーザー単位のアサインは owner、グループ単位は管理者のみ
      canManage: access.role === 'owner' || isAdminActor(user),
      isAdmin: isAdminActor(user),
      members,
      ticketCounts: Object.fromEntries(TICKET_STATUSES.map((status) => [status, byStatus[status] ?? 0])),
    }
  })
export type GetBoardDetailReturnType = Awaited<ReturnType<typeof getBoardDetail>>['data']

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
 * ユーザー単位のアサインを更新する(owner または管理者)。
 * グループ経由メンバーの owner 昇格もこの経路。ownerIds に含めれば BoardMember 行ができる。
 */
export const setBoardMembers = safeAuthAction
  .metadata({ actionName: 'setBoardMembers', role: 'user' })
  .inputSchema(scSetBoardMembers)
  .action(async ({ ctx: { user }, parsedInput: { id, ownerIds, memberIds } }) => {
    await prisma.$transaction(async (tx) => {
      await assertBoardAccess(user, id, 'manage', tx)
      await assertTeamBoard(tx, id)
      await assertBoardAssignmentTargets(tx, { userIds: [...ownerIds, ...memberIds], groupIds: [] })

      // owner が 0 人になるとボードが管理不能になる(管理者は /admin から救済できる)
      if (!canApplyAssignments({ ownerIds, byAdmin: isAdminActor(user) })) {
        throw errInvalidOperation()
      }

      await syncBoardMembers(tx, id, mergeBoardMembers(ownerIds, memberIds))
    })

    logger.info({ userId: user.id, id }, 'board members updated')
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

/** タグ統合(owner または管理者)。同一ボード内のみ */
export const mergeBoardTags = safeAuthAction
  .metadata({ actionName: 'mergeBoardTags', role: 'user' })
  .inputSchema(scMergeTags)
  .action(async ({ ctx: { user }, parsedInput: { boardId, sourceId, targetId } }) => {
    await prisma.$transaction(async (tx) => {
      await assertBoardAccess(user, boardId, 'manage', tx)
      await mergeTags(tx, boardId, sourceId, targetId)
    })

    logger.info({ userId: user.id, boardId, sourceId, targetId }, 'tags merged')
    return { id: targetId }
  })
