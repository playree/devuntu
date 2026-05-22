'use server'

import { safeAuthAction } from '@/lib/action-server'
import { auth } from '@/lib/auth'
import { errSystemError } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scCreateUser } from '@/lib/schema'

/**
 * ユーザー一覧取得
 */
export const getUsers = safeAuthAction.metadata({ actionName: 'getUsers', role: 'admin' }).action(async () => {
  return prisma.user.findMany({ select: { id: true, name: true, email: true, lastLoginAt: true, createdAt: true } })
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
