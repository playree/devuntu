'use server'

import { safeAuthAction } from '@/lib/action-server'
import os from 'os'
import pkg from '../../../package.json'

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
