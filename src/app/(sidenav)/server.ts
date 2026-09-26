'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scUpdateDashboard } from '@/lib/schema/schema-dashboard'

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
      await prisma.dashboard.upsert({
        where: { userId },
        create: { userId, layout },
        update: { layout },
      })
      logger.info({ userId, layout }, 'dashboard updated')

      return { userId }
    },
  )
