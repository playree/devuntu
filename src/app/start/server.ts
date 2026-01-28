'use server'

import { safeAction } from '@/lib/action'
import { auth } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { scCreateAdmin } from '@/lib/schema'

export const createAdmin = safeAction
  .metadata({ actionName: 'createAdmin' })
  .inputSchema(scCreateAdmin)
  .action(async ({ parsedInput: { name, email, password } }) => {
    const res = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name,
      },
    })
    logger.info({ user: res.user }, 'admin created')
    return res.user.id
  })
