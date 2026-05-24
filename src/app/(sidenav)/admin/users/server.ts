'use server'

import { safeAuthAction } from '@/lib/action-server'
import { auth } from '@/lib/auth'
import { errInvalidOperation, errSystemError } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scCreateUser, scUUID } from '@/lib/schema'
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
    // 対象の存在確認
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) {
      throw errInvalidOperation()
    }

    if (user.role === 'admin') {
      if ((await prisma.user.count({ where: { role: 'admin' } })) <= 1) {
        // 最後の管理者ユーザーは削除不可
        return { error: 'CANNOT_DELETE_LAST_ADMIN' }
      }
    }

    await auth.api.removeUser({
      headers: await headers(),
      body: {
        userId: id,
      },
    })
    logger.info({ id }, 'user deleted')
    return { id }
  })
