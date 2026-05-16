'use server'

import { safeAction } from '@/lib/action-server'
import { auth } from '@/lib/auth'
import { errInvalidOperation, errSystemError } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scCreateAdmin } from '@/lib/schema'

export const hasCompletedInitialSetup = async () => {
  const userCount = await prisma.user.count()
  return userCount > 0
}

export const createAdmin = safeAction
  .metadata({ actionName: 'createAdmin' })
  .inputSchema(scCreateAdmin)
  .action(async ({ parsedInput: { name, email, password } }) => {
    if (await hasCompletedInitialSetup()) {
      throw errInvalidOperation()
    }

    // 管理者登録
    const { user } = await auth.api.createUser({
      body: {
        email,
        password,
        name,
        role: 'admin',
      },
    })

    if (!user) {
      throw errSystemError('admin create failed')
    }
    logger.info({ user }, 'admin created')

    return user.id
  })
