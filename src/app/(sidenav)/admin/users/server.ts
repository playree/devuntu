'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { ADVISORY_LOCK_KEYS, withAdvisoryLock } from '@/lib/advisory-lock'
import { auth } from '@/lib/auth/auth'
import { errCannotDeleteLastAdmin, errInvalidOperation, errSystemError } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scUUID } from '@/lib/schema/schema'
import { scCreateUser, scUpdateUser } from '@/lib/schema/schema-admin'
import { headers } from 'next/headers'

/**
 * グループ存在確認（渡された全 groupId が存在しなければ INVALID_OPERATION）
 */
const assertGroupsExist = async (groupIds: string[]) => {
  if (groupIds.length === 0) {
    return
  }
  const count = await prisma.group.count({ where: { id: { in: groupIds } } })
  if (count !== groupIds.length) {
    throw errInvalidOperation()
  }
}

/** AIエージェントは /admin/agents で扱うので、この画面の操作対象から外す */
const assertNotAgent = async (id: string) => {
  const user = await prisma.user.findUnique({ where: { id }, select: { isAgent: true } })
  if (user?.isAgent) {
    throw errInvalidOperation()
  }
}

/**
 * ユーザー一覧取得(AIエージェントは除く)
 */
export const getUsers = safeAuthAction.metadata({ actionName: 'getUsers', role: 'admin' }).action(async () => {
  const users = await prisma.user.findMany({
    where: { isAgent: false },
    select: {
      id: true,
      name: true,
      image: true,
      email: true,
      role: true,
      nameLocked: true,
      lastLoginAt: true,
      createdAt: true,
      userGroups: { select: { group: { select: { id: true, name: true } } } },
    },
  })
  return users.map(({ role, userGroups, ...param }) => ({
    ...param,
    isAdmin: role === 'admin',
    groups: userGroups.map((ug) => ug.group),
  }))
})

/**
 * グループ選択肢取得（id: name のマップ）
 */
export const getGroupOptions = safeAuthAction
  .metadata({ actionName: 'getGroupOptions', role: 'admin' })
  .action(async () => {
    const groups = await prisma.group.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    return Object.fromEntries(groups.map((g) => [g.id, g.name])) as Record<string, string>
  })
export type GetGroupOptionsReturnType = Awaited<ReturnType<typeof getGroupOptions>>['data']

/**
 * ユーザー作成
 */
export const createUser = safeAuthAction
  .metadata({ actionName: 'createUser', role: 'admin' })
  .inputSchema(scCreateUser)
  .action(async ({ parsedInput: { name, email, password, isAdmin, groups } }) => {
    const groupIds = [...new Set(groups)]

    // グループ存在確認（作成前に検証してFK例外/孤立ユーザーを防ぐ）
    await assertGroupsExist(groupIds)

    // ユーザー作成
    const { user } = await auth.api.createUser({
      headers: await headers(),
      body: {
        email,
        password,
        name,
        role: isAdmin ? 'admin' : 'user',
      },
    })

    if (!user) {
      throw errSystemError('user create failed')
    }

    // グループ紐付け
    if (groupIds.length > 0) {
      await prisma.userGroup.createMany({
        data: groupIds.map((groupId) => ({ userId: user.id, groupId })),
      })
    }

    logger.info({ user, groups: groupIds }, 'user created')

    return { id: user.id, name: user.name }
  })

/**
 * ユーザー削除
 */
export const deleteUser = safeAuthAction
  .metadata({ actionName: 'deleteUser', role: 'admin' })
  .inputSchema(scUUID)
  .action(async ({ parsedInput: { id } }) => {
    await assertNotAgent(id)

    // better-auth は別の接続で書き込むので、$transaction だけでは判定と削除の間に割り込まれる。
    // 降格(updateUser)と同じロックで直列化し、2人の管理者を同時に消して0人になるのを防ぐ
    await withAdvisoryLock(ADVISORY_LOCK_KEYS.adminRole, async (tx) => {
      // 対象の存在確認
      const user = await tx.user.findUnique({ where: { id }, select: { id: true, role: true } })
      if (!user) {
        throw errInvalidOperation()
      }

      if (user.role === 'admin') {
        if ((await tx.user.count({ where: { role: 'admin', id: { not: id } } })) === 0) {
          // 最後の管理者ユーザーは削除不可
          throw errCannotDeleteLastAdmin()
        }
      }

      await auth.api.removeUser({
        headers: await headers(),
        body: {
          userId: id,
        },
      })
    })

    logger.info({ id }, 'user deleted')
    return { id }
  })

/**
 * ユーザー更新
 */
export const updateUser = safeAuthAction
  .metadata({ actionName: 'updateUser', role: 'admin' })
  .inputSchema(scUpdateUser)
  .action(async ({ parsedInput: { id, name, email, isAdmin, nameLocked, groups } }) => {
    const groupIds = [...new Set(groups)]

    await assertNotAgent(id)

    // グループ存在確認（auth 更新前に検証してFK例外/部分更新を防ぐ）
    await assertGroupsExist(groupIds)

    // 最後の管理者の判定と権限更新の間に、他の削除・降格が割り込まないよう直列化する
    // (auth は別クライアントなので、ロックを持ったトランザクションの外から書き込まれる)
    await withAdvisoryLock(ADVISORY_LOCK_KEYS.adminRole, async (tx) => {
      // 対象の存在確認
      const user = await tx.user.findUnique({ where: { id }, select: { id: true, role: true } })
      if (!user) {
        throw errInvalidOperation()
      }

      // 管理者権限を消す場合
      if (user.role === 'admin' && !isAdmin) {
        if ((await tx.user.count({ where: { role: 'admin', id: { not: id } } })) === 0) {
          // 最後の管理者ユーザーは不可
          throw errCannotDeleteLastAdmin()
        }
      }

      // プロフィール/権限更新
      await auth.api.adminUpdateUser({
        headers: await headers(),
        body: {
          userId: id,
          data: {
            name,
            email,
            role: isAdmin ? 'admin' : 'user',
            nameLocked,
          },
        },
      })
    })

    // グループ再構築（この2操作のみ原子的に）
    await prisma.$transaction([
      prisma.userGroup.deleteMany({ where: { userId: id } }),
      ...(groupIds.length > 0
        ? [prisma.userGroup.createMany({ data: groupIds.map((groupId) => ({ userId: id, groupId })) })]
        : []),
    ])

    logger.info({ id, groups: groupIds }, 'user updated')
    return { id }
  })
