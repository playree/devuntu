/**
 * グループの存在確認・所属の総入れ替え・選択肢(サーバー専用)
 */

import { errInvalidOperation } from './error'
import { type Db, prisma } from './prisma'

/** 渡された全 groupId が存在するかを検証する。1 つでも無ければ errInvalidOperation() */
export const assertGroupsExist = async (groupIds: string[], tx: Db = prisma): Promise<void> => {
  if (groupIds.length === 0) {
    return
  }
  const count = await tx.group.count({ where: { id: { in: groupIds } } })
  if (count !== groupIds.length) {
    throw errInvalidOperation()
  }
}

/** ユーザーの所属グループを総入れ替えする。削除と作成の 2 操作だけを原子的に行う */
export const syncUserGroups = async (userId: string, groupIds: string[]): Promise<void> => {
  await prisma.$transaction([
    prisma.userGroup.deleteMany({ where: { userId } }),
    ...(groupIds.length > 0
      ? [prisma.userGroup.createMany({ data: groupIds.map((groupId) => ({ userId, groupId })) })]
      : []),
  ])
}

/** グループの選択肢(id → 名前)。名前順 */
export const listGroupOptions = async (tx: Db = prisma): Promise<Record<string, string>> => {
  const groups = await tx.group.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
  return Object.fromEntries(groups.map((g) => [g.id, g.name]))
}

/**
 * 直接メンバーとグループ経由のユーザーを 1 人 1 行に畳み、名前順で返す。
 * 同じユーザーが両方に居る場合は直接メンバーを優先する(外す対象の行を持つのは直接メンバーだけのため)。
 */
export const mergeMemberUsers = <T extends { id: string; name: string }>(direct: T[], viaGroup: T[]): T[] => {
  const users = new Map<string, T>()
  for (const user of direct) {
    users.set(user.id, user)
  }
  for (const user of viaGroup) {
    if (!users.has(user.id)) {
      users.set(user.id, user)
    }
  }
  return [...users.values()].sort((a, b) => a.name.localeCompare(b.name))
}
