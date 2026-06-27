'use server'

import { safeAuthAction } from '@/lib/action-server'
import { auth } from '@/lib/auth'
import { ClientError, errInvalidOperation, errSystemError } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scCreateUser, scUpdateUser, scUUID } from '@/lib/schema'
import { headers } from 'next/headers'

/**
 * ユーザー一覧取得
 */
export const getUsers = safeAuthAction.metadata({ actionName: 'getUsers', role: 'admin' }).action(async () => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, lastLoginAt: true, createdAt: true },
  })
  return users.map(({ role, ...param }) => ({ ...param, isAdmin: role === 'admin' }))
})

/**
 * ユーザー作成
 */
export const createUser = safeAuthAction
  .metadata({ actionName: 'createUser', role: 'admin' })
  .inputSchema(scCreateUser)
  .action(async ({ parsedInput: { name, email, password, isAdmin } }) => {
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
    logger.info({ user }, 'user created')

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
  .action(async ({ parsedInput: { id, name, email, isAdmin } }) => {
    await prisma.$transaction(async (tx) => {
      // 対象の存在確認
      const user = await tx.user.findUnique({ where: { id }, select: { id: true, role: true } })
      if (!user) {
        throw errInvalidOperation()
      }

      // 管理者権限を消す場合
      if (user.role === 'admin' && !isAdmin) {
        if ((await tx.user.count({ where: { role: 'admin', id: { not: id } } })) === 0) {
          // 最後の管理者ユーザーは不可
          throw new ClientError('CANNOT_DELETE_LAST_ADMIN')
        }
      }

      await auth.api.adminUpdateUser({
        headers: await headers(),
        body: {
          userId: id,
          data: {
            name,
            email,
            role: isAdmin ? 'admin' : 'user',
          },
        },
      })
    })

    logger.info({ id }, 'user updated')
    return { id }
  })
