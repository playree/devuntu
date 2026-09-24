'use server'

import { safeAction } from '@/lib/action/action-server'
import { ADVISORY_LOCK_KEYS, withAdvisoryLock } from '@/lib/advisory-lock'
import { auth } from '@/lib/auth/auth'
import { errInvalidOperation, errSystemError } from '@/lib/error'
import { hasCompletedInitialSetup } from '@/lib/initial-setup'
import { logger } from '@/lib/logger'
import { scCreateAdmin } from '@/lib/schema/schema'

export const createAdmin = safeAction
  .metadata({ actionName: 'createAdmin' })
  .inputSchema(scCreateAdmin)
  .action(async ({ parsedInput: { name, email, password } }) => {
    // 同時に送られると両方が「未セットアップ」と判定して管理者が複数作られるので、判定と作成を直列化する
    const { user } = await withAdvisoryLock(ADVISORY_LOCK_KEYS.initialSetup, async (tx) => {
      if (await hasCompletedInitialSetup(tx)) {
        throw errInvalidOperation()
      }

      return auth.api.createUser({
        body: {
          email,
          password,
          name,
          role: 'admin',
        },
      })
    })

    if (!user) {
      throw errSystemError('admin create failed')
    }
    logger.info({ user }, 'admin created')

    return { id: user.id, name: user.name }
  })
