'use server'

import { safeAuthAction } from '@/lib/action-server'
import { auth } from '@/lib/auth'
import { GOOGLE_ACCOUNT_PROVIDER_ID } from '@/lib/google-calendar'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { headers } from 'next/headers'

/**
 * Google アカウント連携状態の取得
 */
export const getGoogleAccountStatus = safeAuthAction
  .metadata({ actionName: 'getGoogleAccountStatus', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    const account = await prisma.account.findFirst({
      where: { userId: user.id, providerId: GOOGLE_ACCOUNT_PROVIDER_ID },
      select: { scope: true, refreshToken: true },
    })
    // リフレッシュトークンが無い場合は未連携扱い
    const connected = !!account?.refreshToken
    return {
      connected,
      scopes: connected ? (account?.scope?.split(',').filter(Boolean) ?? []) : [],
    }
  })
export type GetGoogleAccountStatusReturnType = Awaited<ReturnType<typeof getGoogleAccountStatus>>['data']

/**
 * Google アカウント連携の解除
 */
export const disconnectGoogleAccount = safeAuthAction
  .metadata({ actionName: 'disconnectGoogleAccount', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    await auth.api.unlinkAccount({
      body: { providerId: GOOGLE_ACCOUNT_PROVIDER_ID },
      headers: await headers(),
    })

    logger.info({ userId: user.id }, 'google account disconnected')
    return { disconnected: true }
  })
