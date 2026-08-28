'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { errSystemError } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scUpdateDashboard } from '@/lib/schema/schema'

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
