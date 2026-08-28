'use server'

import { safeAction } from '@/lib/action/action-server'
import { auth } from '@/lib/auth/auth'
import { prisma } from '@/lib/prisma'
import { assertRateLimit } from '@/lib/rate-limit'
import { scSignInUsername } from '@/lib/schema/schema'
import { getClientIp } from '@/lib/server-utils'

/**
 * 未認証で叩ける Action なので自前でレート制限する。
 *
 * この Action は OTP 運用時に `auth.api.sendVerificationOTP` をサーバー内部呼び出しする。
 * better-auth の rateLimit は `/api/auth/*` の HTTP 層にしか掛からずこの経路は素通りするため、
 * 制限が無いと実在アドレスへのメール爆撃とメール送信費用の消費に使われる。
 *
 * IP 側はパスワード運用時の総当たり入口も兼ねて広めに、メール側は送信回数として狭く取る。
 */
const IP_RATE_LIMIT = { limit: 20, windowMs: 10 * 60 * 1000 }
const EMAIL_RATE_LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 }

export const getUserByEmail = safeAction
  .metadata({ actionName: 'getUserByEmail' })
  .inputSchema(scSignInUsername)
  .action(async ({ parsedInput: { username } }) => {
    // DB 参照より前に消費して、存在判定の探りにもコストが掛かるようにする
    assertRateLimit(`signin:ip:${await getClientIp()}`, IP_RATE_LIMIT)

    // ユーザー検索(AIエージェントは Web ログインできないので未存在として扱う)
    const found = await prisma.user.findUnique({ where: { email: username } })
    const user = found?.isAgent ? null : found
    // 認証方法
    const next: 'PASSWORD' | 'OTP' = auth.options.emailAndPassword.enabled ? 'PASSWORD' : 'OTP'

    if (next === 'OTP' && user?.email) {
      // OTPの場合
      assertRateLimit(`signin:otp:${user.email.toLowerCase()}`, EMAIL_RATE_LIMIT)
      await auth.api.sendVerificationOTP({
        body: {
          email: user.email,
          type: 'sign-in',
        },
      })
    }
    return { next }
  })
