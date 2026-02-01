'use server'

import { safeAction } from '@/lib/action'
import { auth } from '@/lib/auth'
import { errSystemError } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scCreateAdmin } from '@/lib/schema'

export const createAdmin = safeAction
  .metadata({ actionName: 'createAdmin' })
  .inputSchema(scCreateAdmin)
  .action(async ({ parsedInput: { name, email, password } }) => {
    // ユーザー登録
    const res = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name,
      },
    })

    if (!res.token) {
      throw errSystemError('admin create failed')
    }

    // 管理者に昇格
    const user = await prisma.user.update({ where: { id: res.user.id }, data: { isAdmin: true } })
    logger.info({ user }, 'admin created')

    return user.id
  })
