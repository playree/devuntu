'use server'

import { safeAction } from '@/lib/action'
import { auth } from '@/lib/auth'
import { errSystemError } from '@/lib/error'
import { logger } from '@/lib/logger'
import { scCreateAdmin } from '@/lib/schema'

export const createAdmin = safeAction
  .metadata({ actionName: 'createAdmin' })
  .inputSchema(scCreateAdmin)
  .action(async ({ parsedInput: { name, email, password } }) => {
    // 管理者登録
    const { user } = await auth.api.createUser({
      body: {
        email,
        password,
        name,
        role: 'admin',
      },
    })

    logger.info({ user }, 'admin created')
    if (!user) {
      throw errSystemError('admin create failed')
    }

    return user.id
  })
