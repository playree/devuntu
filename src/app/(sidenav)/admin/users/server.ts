'use server'

import { safeAuthAction } from '@/lib/action-server'
import { auth } from '@/lib/auth'
import { ClientError, errInvalidOperation, errSystemError } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scCreateUser, scUpdateUser, scUUID } from '@/lib/schema'
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

/**
 * ユーザー一覧取得
 */
export const getUsers = safeAuthAction.metadata({ actionName: 'getUsers', role: 'admin' }).action(async () => {
  const users = await prisma.user.findMany({
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
    await prisma.$transaction(async (tx) => {
      // 対象の存在確認
      const user = await tx.user.findUnique({ where: { id }, select: { id: true, role: true } })
      if (!user) {
        throw errInvalidOperation()
      }

      if (user.role === 'admin') {
        if ((await tx.user.count({ where: { role: 'admin', id: { not: id } } })) === 0) {
          // 最後の管理者ユーザーは削除不可
          throw new ClientError('CANNOT_DELETE_LAST_ADMIN')
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

    // 対象の存在確認
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } })
    if (!user) {
      throw errInvalidOperation()
    }

    // 管理者権限を消す場合
    if (user.role === 'admin' && !isAdmin) {
      if ((await prisma.user.count({ where: { role: 'admin', id: { not: id } } })) === 0) {
        // 最後の管理者ユーザーは不可
        throw new ClientError('CANNOT_DELETE_LAST_ADMIN')
      }
    }

    // グループ存在確認（auth 更新前に検証してFK例外/部分更新を防ぐ）
    await assertGroupsExist(groupIds)

    // プロフィール/権限更新（auth は別クライアントのためトランザクション対象外）
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
