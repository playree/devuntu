'use server'

import { safeAuthAction } from '@/lib/action-server'
import { errSystemError } from '@/lib/error'
import { canUseGoogleAccount } from '@/lib/google-account'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scUpdateDashboard } from '@/lib/schema'

/**
 * ログイン中ユーザーが Google アカウント連携を利用できるかを取得する
 * (メニューのカレンダー表示制御などクライアントからの参照用)
 */
export const getMyGoogleAccountAccess = safeAuthAction
  .metadata({ actionName: 'getMyGoogleAccountAccess', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    return { available: await canUseGoogleAccount(user.id) }
  })

/**
 * ダッシュボード更新
 */
export const updateDashboard = safeAuthAction
  .metadata({ actionName: 'updateDashboard', role: 'user' })
  .inputSchema(scUpdateDashboard)
  .action(
    async ({
      parsedInput: { layout },
      ctx: {
        user: { id: userId },
      },
    }) => {
      const res = await prisma.dashboard.upsert({
        where: { userId },
        create: { userId, layout },
        update: { layout },
      })

      if (!res) {
        throw errSystemError('dashboard update failed')
      }
      logger.info({ userId, layout }, 'dashboard updated')

      return { userId }
    },
  )
