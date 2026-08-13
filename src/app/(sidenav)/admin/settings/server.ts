'use server'

import { safeAuthAction } from '@/lib/action-server'
import { getGoogleAccountSettings, setGoogleAccountSettings } from '@/lib/google-account'
import { prisma } from '@/lib/prisma'
import { scUpdateGoogleAccountSettings, scUpdateSlackSettings } from '@/lib/schema'
import { getSlackSettings, hasSlackCredentials, setSlackSettings } from '@/lib/slack-account'
import { getSlackBotInfo } from '@/lib/slack-server'

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

/**
 * Slack 連携設定とグループ一覧の取得
 *
 * Bot の接続先ワークスペースも併せて返し、SLACK_BOT_TOKEN の設定ミスに気付けるようにする。
 */
export const getSlackSettingsAction = safeAuthAction
  .metadata({ actionName: 'getSlackSettings', role: 'admin' })
  .action(async () => {
    const [settings, groups, botInfo] = await Promise.all([
      getSlackSettings(),
      prisma.group.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      getSlackBotInfo(),
    ])
    return {
      enabled: settings.enabled,
      allowedGroupIds: settings.allowedGroupIds,
      groupOptions: Object.fromEntries(groups.map((g) => [g.id, g.name])) as Record<string, string>,
      hasCredentials: hasSlackCredentials(),
      workspace: botInfo ? { teamId: botInfo.teamId, team: botInfo.team } : null,
    }
  })
export type GetSlackSettingsReturnType = Awaited<ReturnType<typeof getSlackSettingsAction>>['data']

/**
 * Slack 連携設定の更新
 */
export const updateSlackSettingsAction = safeAuthAction
  .metadata({ actionName: 'updateSlackSettings', role: 'admin' })
  .inputSchema(scUpdateSlackSettings)
  .action(async ({ parsedInput: { enabled, allowedGroupIds } }) => {
    await setSlackSettings({ enabled, allowedGroupIds })
    return { enabled, allowedGroupIds }
  })
