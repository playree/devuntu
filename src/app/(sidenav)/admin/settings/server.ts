'use server'

import { safeAuthAction } from '@/lib/action-server'
import { getGoogleAccountSettings, setGoogleAccountSettings } from '@/lib/google-account'
import { prisma } from '@/lib/prisma'
import { scUpdateGoogleAccountSettings } from '@/lib/schema'

/**
 * Google アカウント連携設定とグループ一覧の取得
 */
export const getGoogleAccountSettingsAction = safeAuthAction
  .metadata({ actionName: 'getGoogleAccountSettings', role: 'admin' })
  .action(async () => {
    const [settings, groups] = await Promise.all([
      getGoogleAccountSettings(),
      prisma.group.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ])
    return {
      enabled: settings.enabled,
      allowedGroupIds: settings.allowedGroupIds,
      groupOptions: Object.fromEntries(groups.map((g) => [g.id, g.name])) as Record<string, string>,
    }
  })
export type GetGoogleAccountSettingsReturnType = Awaited<ReturnType<typeof getGoogleAccountSettingsAction>>['data']

/**
 * Google アカウント連携設定の更新
 */
export const updateGoogleAccountSettingsAction = safeAuthAction
  .metadata({ actionName: 'updateGoogleAccountSettings', role: 'admin' })
  .inputSchema(scUpdateGoogleAccountSettings)
  .action(async ({ parsedInput: { enabled, allowedGroupIds } }) => {
    await setGoogleAccountSettings({ enabled, allowedGroupIds })
    return { enabled, allowedGroupIds }
  })
