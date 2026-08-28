'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { getGoogleAccountSettings, setGoogleAccountSettings } from '@/lib/google/google-account'
import { prisma } from '@/lib/prisma'
import { scUpdateIntegrationSettings } from '@/lib/schema/schema'
import { getSlackSettings, setSlackSettings } from '@/lib/slack/slack-account'
import { getSlackBotInfo } from '@/lib/slack/slack-server'

/**
 * 連携設定画面の初期表示データ。
 *
 * グループ一覧は連携をまたいで共通なので、連携ごとにアクションを分けず 1 回で取り切る。
 * Slack は Bot の接続先ワークスペースも併せて返し、SLACK_BOT_TOKEN の設定ミスに気付けるようにする。
 */
export const getIntegrationSettingsAction = safeAuthAction
  .metadata({ actionName: 'getIntegrationSettings', role: 'admin' })
  .action(async () => {
    const [google, slack, groups, botInfo] = await Promise.all([
      getGoogleAccountSettings(),
      getSlackSettings(),
      prisma.group.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      getSlackBotInfo(),
    ])
    return {
      groupOptions: Object.fromEntries(groups.map((g) => [g.id, g.name])) as Record<string, string>,
      google,
      slack: {
        ...slack,
        workspace: botInfo ? { teamId: botInfo.teamId, team: botInfo.team } : null,
      },
    }
  })
export type GetIntegrationSettingsReturnType = Awaited<ReturnType<typeof getIntegrationSettingsAction>>['data']

/**
 * Google アカウント連携設定の更新
 */
export const updateGoogleAccountSettingsAction = safeAuthAction
  .metadata({ actionName: 'updateGoogleAccountSettings', role: 'admin' })
  .inputSchema(scUpdateIntegrationSettings)
  .action(async ({ parsedInput: { enabled, allowedGroupIds } }) => {
    await setGoogleAccountSettings({ enabled, allowedGroupIds })
    return { enabled, allowedGroupIds }
  })

/**
 * Slack 連携設定の更新
 */
export const updateSlackSettingsAction = safeAuthAction
  .metadata({ actionName: 'updateSlackSettings', role: 'admin' })
  .inputSchema(scUpdateIntegrationSettings)
  .action(async ({ parsedInput: { enabled, allowedGroupIds } }) => {
    await setSlackSettings({ enabled, allowedGroupIds })
    return { enabled, allowedGroupIds }
  })
