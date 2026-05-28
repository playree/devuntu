'use server'

import { safeAction } from '@/lib/action-server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { scSignInUsername } from '@/lib/schema'

export const getUserByEmail = safeAction
  .metadata({ actionName: 'getUserByEmail' })
  .inputSchema(scSignInUsername)
  .action(async ({ parsedInput: { username } }) => {
    // ユーザー検索
    const user = await prisma.user.findUnique({ where: { email: username } })
    // 認証方法
    const next: 'PASSWORD' | 'OTP' = auth.options.emailAndPassword.enabled ? 'PASSWORD' : 'OTP'

    if (next === 'OTP' && user?.email) {
      // OTPの場合
      await auth.api.sendVerificationOTP({
        body: {
          email: user.email,
          type: 'sign-in',
        },
      })
    }
    return { next }
  })
