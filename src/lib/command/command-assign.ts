/**
 * ターゲットへのアサインの読み書き(サーバー専用)
 *
 * 認可判定そのものは `command-access.ts` に置き、ここは DB の出し入れに徹する
 * (`board-member.ts` と同じ切り分け)。呼び出し側が管理者かどうかを先に確かめること。
 *
 * ターゲットの実体は YAML にあり DB に行が無いため `targetKey` に FK を張れない。
 * 定義から消えたターゲットのアサインが残りうるので、**権限判定に使う経路は必ず
 * カタログに載っているキーだけを渡す**(`command-access.ts`)。ここは渡されたキーをそのまま扱う。
 */

import type { Prisma } from '@/generated/prisma/client'
import { errInvalidOperation } from '../error'
import { listGroupOptions, mergeMemberUsers } from '../group'
import { prisma, type Db } from '../prisma'
import { type CommandTargetRole } from './command'

/** アサインされたユーザー1人ぶんの表示用の形 */
export type CommandTargetUser = {
  id: string
  name: string
  email: string
  image: string | null
  isAgent: boolean
  /** 直接メンバーのロール。グループ経由のみの場合は null */
  role: CommandTargetRole | null
  via: 'member' | 'group'
}

const userSelect = { id: true, name: true, email: true, image: true, isAgent: true } as const

/**
 * ターゲットのメンバー実体(直接メンバー ∪ グループ所属ユーザー)。
 *
 * 同じユーザーが両方に居る場合は直接メンバーを優先する。グループ経由だけのユーザーは
 * 外す対象の行を持たないため、`role` を null にして画面側で削除させないようにする。
 */
export const getCommandTargetUsers = async (targetKey: string, tx: Db = prisma): Promise<CommandTargetUser[]> => {
  const [members, groups] = await Promise.all([
    tx.commandTargetMember.findMany({ where: { targetKey }, select: { role: true, user: { select: userSelect } } }),
    tx.commandTargetGroup.findMany({
      where: { targetKey },
      select: { group: { select: { userGroups: { select: { user: { select: userSelect } } } } } },
    }),
  ])

  return mergeMemberUsers<CommandTargetUser>(
    members.map(({ role, user }) => ({ ...user, role, via: 'member' })),
    groups.flatMap(({ group }) => group.userGroups.map(({ user }) => ({ ...user, role: null, via: 'group' }))),
  )
}

/** アサイン編集フォームの初期値と選択肢 */
export const getCommandTargetAssignments = async (targetKey: string) => {
  const [members, targetGroups, users, groups] = await Promise.all([
    prisma.commandTargetMember.findMany({ where: { targetKey }, select: { userId: true, role: true } }),
    prisma.commandTargetGroup.findMany({ where: { targetKey }, select: { groupId: true } }),
    prisma.user.findMany({ select: userSelect, orderBy: { name: 'asc' } }),
    listGroupOptions(),
  ])

  return {
    memberUserIds: members.map((member) => member.userId),
    groupIds: targetGroups.map((group) => group.groupId),
    // 構造は `components/user-select.tsx` の UserSelectOption と一致させること
    userOptions: users,
    groupOptions: groups,
  }
}

/** 直接メンバー1行を追加 / 更新する。追加と編集で処理が同じなので実体を共有する */
export const upsertCommandTargetMember = async (
  tx: Prisma.TransactionClient,
  { targetKey, userId, role }: { targetKey: string; userId: string; role: CommandTargetRole },
): Promise<void> => {
  await tx.commandTargetMember.upsert({
    where: { targetKey_userId: { targetKey, userId } },
    create: { targetKey, userId, role },
    update: { role },
  })
}

/** 直接メンバーを外す。グループ経由のメンバーは行を持たないため対象にならない */
export const removeCommandTargetMember = async (
  tx: Prisma.TransactionClient,
  { targetKey, userId }: { targetKey: string; userId: string },
): Promise<void> => {
  const member = await tx.commandTargetMember.findUnique({
    where: { targetKey_userId: { targetKey, userId } },
    select: { id: true },
  })
  if (!member) {
    throw errInvalidOperation()
  }
  await tx.commandTargetMember.delete({ where: { id: member.id } })
}

/**
 * グループ単位のアサインを総入れ替えする。
 *
 * 画面から渡ってくるのは選択後の集合なので、差分計算を挟むと
 * 「消したはずのグループが残る」経路を作り込みやすい(`syncBoardGroups` と同じ理由)。
 */
export const syncCommandTargetGroups = async (
  tx: Prisma.TransactionClient,
  targetKey: string,
  groupIds: string[],
): Promise<void> => {
  await tx.commandTargetGroup.deleteMany({ where: { targetKey } })
  if (groupIds.length > 0) {
    await tx.commandTargetGroup.createMany({
      data: [...new Set(groupIds)].map((groupId) => ({ targetKey, groupId })),
    })
  }
}

/** 指定 ID のユーザー / グループがすべて存在するかを検証する */
export const assertCommandAssignmentTargets = async (
  tx: Db,
  { userIds, groupIds }: { userIds: string[]; groupIds: string[] },
): Promise<void> => {
  const [userCount, groupCount] = await Promise.all([
    userIds.length > 0 ? tx.user.count({ where: { id: { in: userIds } } }) : Promise.resolve(0),
    groupIds.length > 0 ? tx.group.count({ where: { id: { in: groupIds } } }) : Promise.resolve(0),
  ])

  if (userCount !== new Set(userIds).size || groupCount !== new Set(groupIds).size) {
    throw errInvalidOperation()
  }
}

/** アサインが1件でも存在するターゲットキー。カタログとの差分から孤児を見つけるのに使う */
export const listAssignedTargetKeys = async (): Promise<string[]> => {
  const [members, groups] = await Promise.all([
    prisma.commandTargetMember.findMany({ distinct: ['targetKey'], select: { targetKey: true } }),
    prisma.commandTargetGroup.findMany({ distinct: ['targetKey'], select: { targetKey: true } }),
  ])
  return [...new Set([...members, ...groups].map(({ targetKey }) => targetKey))].sort()
}

/** 件数だけを引く。一覧に「何人 / 何グループ割り当てているか」を出すのに使う */
export const countCommandTargetAssignments = async (
  targetKeys: string[],
): Promise<Map<string, { members: number; groups: number }>> => {
  const counts = new Map(targetKeys.map((key) => [key, { members: 0, groups: 0 }]))
  if (targetKeys.length === 0) {
    return counts
  }

  const [members, groups] = await Promise.all([
    prisma.commandTargetMember.groupBy({ by: ['targetKey'], where: { targetKey: { in: targetKeys } }, _count: true }),
    prisma.commandTargetGroup.groupBy({ by: ['targetKey'], where: { targetKey: { in: targetKeys } }, _count: true }),
  ])
  members.forEach((row) => {
    const count = counts.get(row.targetKey)
    if (count) {
      count.members = row._count
    }
  })
  groups.forEach((row) => {
    const count = counts.get(row.targetKey)
    if (count) {
      count.groups = row._count
    }
  })
  return counts
}

/** ターゲット1件ぶんのアサインをすべて消す。定義から消えたターゲットの後始末に使う */
export const deleteCommandTargetAssignments = async (
  targetKey: string,
): Promise<{ members: number; groups: number }> => {
  const [members, groups] = await prisma.$transaction([
    prisma.commandTargetMember.deleteMany({ where: { targetKey } }),
    prisma.commandTargetGroup.deleteMany({ where: { targetKey } }),
  ])
  return { members: members.count, groups: groups.count }
}
