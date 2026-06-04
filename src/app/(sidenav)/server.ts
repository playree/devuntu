'use server'

import { safeAuthAction } from '@/lib/action-server'
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
