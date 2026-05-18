'use server'

import { safeAction } from '@/lib/action-server'
import { auth } from '@/lib/auth'
import { envu } from '@/lib/env-util'
import { prisma } from '@/lib/prisma'
import { scSignInUsername } from '@/lib/schema'

export const getUserByEmail = safeAction
  .metadata({ actionName: 'getUserByEmail' })
  .inputSchema(scSignInUsername)
  .action(async ({ parsedInput: { username } }) => {
    const user = await prisma.user.findUnique({ where: { email: username } })
    const next: 'PASSWORD' | 'OTP' = envu.server.DISABLE_PASSWORD_AUTH ? 'OTP' : 'PASSWORD'
    if (next === 'OTP' && user?.email) {
      await auth.api.sendVerificationOTP({
        body: {
          email: user.email,
          type: 'sign-in',
        },
      })
    }
    return { next }
  })
