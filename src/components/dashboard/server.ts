'use server'

import { safeAuthAction } from '@/lib/action-server'
import { prisma } from '@/lib/prisma'
import os from 'os'
import pkg from '../../../package.json'

/**
 * LinkWidget一覧取得(ダッシュボード表示用)
 */
export const getUserLinkWidgets = safeAuthAction
  .metadata({ actionName: 'getUserLinkWidgets', role: 'user' })
  .action(async () => {
    return prisma.linkWidget.findMany({
      select: { id: true, name: true, url: true, description: true, iconPath: true },
    })
  })
export type GetUserLinkWidgetsReturnType = Awaited<ReturnType<typeof getUserLinkWidgets>>['data']

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
