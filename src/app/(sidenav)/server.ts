'use server'

import { safeAuthAction } from '@/lib/action-server'
import { errSystemError } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scUpdateDashboard } from '@/lib/schema'
import os from 'os'
import pkg from '../../../package.json'

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

/**
 * アプリ情報取得
 */
export const getAppInfo = safeAuthAction.metadata({ actionName: 'getAppInfo', role: 'user' }).action(async () => {
  const { version, buildno } = pkg
  return {
    version,
    buildno,
  }
})
export type GetAppInfoReturnType = Awaited<ReturnType<typeof getAppInfo>>['data']

/**
 * サーバー情報取得
 */
export const getServerInfo = safeAuthAction.metadata({ actionName: 'getServerInfo', role: 'user' }).action(async () => {
  return {
    memory: { total: os.totalmem(), free: os.freemem() },
    uptime: os.uptime(),
  }
})
export type GetServerInfoReturnType = Awaited<ReturnType<typeof getServerInfo>>['data']
