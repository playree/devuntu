/**
 * ボードのアサイン(直接メンバー / グループ)の読み書き(サーバー専用)
 *
 * `/boards/[id]/settings` の Server Action から呼ぶ。権限の検証もここで行う。
 * 権限境界: ユーザー単位のアサインは owner または管理者、グループ単位は管理者のみ。
 */

import type { Prisma } from '@/generated/prisma/client'
import { errInvalidOperation } from '../error'
import { listGroupOptions } from '../group'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { assertBoardAccess, assertTeamBoard, isAdminActor, type Actor } from './board-access'
import { assertBoardAssignmentTargets, BOARD_USER_SELECT, syncBoardGroups } from './board-member'
import { canApplyAssignments, type BoardRole } from './ticket-permission'

/** アサイン編集フォームの初期値(直接メンバー + グループ + 選択肢) */
export const getBoardAssignments = async (actor: Actor, id: string) => {
  await assertBoardAccess(actor, id, 'manage')

  const [board, users, groups] = await Promise.all([
    prisma.board.findUnique({
      where: { id },
      select: {
        members: { select: { userId: true, role: true } },
        groups: { select: { groupId: true } },
      },
    }),
    prisma.user.findMany({
      select: BOARD_USER_SELECT,
      orderBy: { name: 'asc' },
    }),
    listGroupOptions(),
  ])
  if (!board) {
    throw errInvalidOperation()
  }

  return {
    ownerIds: board.members.filter((m) => m.role === 'owner').map((m) => m.userId),
    memberIds: board.members.filter((m) => m.role === 'member').map((m) => m.userId),
    groupIds: board.groups.map((g) => g.groupId),
    userOptions: users, // 構造は `components/user-select.tsx` の UserSelectOption と一致させること
    groupOptions: groups,
  }
}

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
const upsertBoardMemberRow = async (
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

/**
 * メンバーを 1 人追加する / ロールを変更する(owner または管理者)。既に直接メンバーならロールを上書きする。
 * グループ経由メンバーもここで直接ロールを付与できる(付与後は via='member' になる)。
 */
export const upsertBoardMember = async (actor: Actor, input: { boardId: string; userId: string; role: BoardRole }) =>
  prisma.$transaction((tx) => upsertBoardMemberRow(tx, { actor, ...input }))

/**
 * 直接メンバーを外す(owner または管理者)。
 * グループ経由メンバーは BoardMember 行を持たないため対象外(ボードグループ設定で外す)。
 */
export const removeBoardMember = async (actor: Actor, { boardId, userId }: { boardId: string; userId: string }) => {
  await prisma.$transaction(async (tx) => {
    await assertBoardAccess(actor, boardId, 'manage', tx)
    await assertTeamBoard(tx, boardId)

    const member = await tx.boardMember.findUnique({
      where: { boardId_userId: { boardId, userId } },
      select: { id: true },
    })
    if (!member) {
      throw errInvalidOperation()
    }

    await assertOwnerRemains(tx, { actor, boardId, userId, nextRole: null })
    await tx.boardMember.delete({ where: { id: member.id } })
  })

  logger.info({ userId: actor.id, id: boardId, targetId: userId }, 'board member removed')
}

/** グループ単位のアサインを更新する(管理者のみ) */
export const setBoardGroups = async (actor: Actor, { boardId, groupIds }: { boardId: string; groupIds: string[] }) => {
  // ボードの owner でも変更させない
  if (!isAdminActor(actor)) {
    throw errInvalidOperation()
  }

  await prisma.$transaction(async (tx) => {
    await assertBoardAccess(actor, boardId, 'manage', tx)
    await assertTeamBoard(tx, boardId)
    await assertBoardAssignmentTargets(tx, { userIds: [], groupIds })
    await syncBoardGroups(tx, boardId, groupIds)
  })

  logger.info({ userId: actor.id, id: boardId }, 'board groups updated')
}
