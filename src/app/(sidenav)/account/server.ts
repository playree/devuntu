'use server'

import { safeAuthAction } from '@/lib/action-server'
import { isValidTimezone } from '@/lib/day'
import { errValidation } from '@/lib/error'
import { canUseGoogleAccount, googleAccountQuery } from '@/lib/google-account'
import { GOOGLE_ACCOUNT_PROVIDER_ID } from '@/lib/google-calendar'
import { logger } from '@/lib/logger'
import { getUserNotifySettings, setUserNotifySetting } from '@/lib/notify-setting'
import { prisma } from '@/lib/prisma'
import { scUpdateNotifySetting } from '@/lib/schema'
import { SLACK_PROVIDER_ID } from '@/lib/slack'
import { canUseSlackAccount } from '@/lib/slack-account'
import { z } from 'zod'

export const getGoogleAccountStatus = safeAuthAction
  .metadata({ actionName: 'getGoogleAccountStatus', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    // 連携が利用不可なユーザーには未連携として返す(UI非表示のバックアップ)
    if (!(await canUseGoogleAccount(user.id))) {
      return { connected: false, scopes: [] as string[] }
    }
    // googleAccountQuery が refresh token を持つ行だけに絞るので、行の有無が連携済みかどうか
    const account = await prisma.account.findFirst({
      ...googleAccountQuery(user.id),
      select: { scope: true },
    })
    const connected = !!account
    return {
      connected,
      scopes: connected ? (account?.scope?.split(',').filter(Boolean) ?? []) : [],
    }
  })
export type GetGoogleAccountStatusReturnType = Awaited<ReturnType<typeof getGoogleAccountStatus>>['data']

/**
 * better-auth の unlinkAccount は使わない。
 * あちらはログイン資格情報の削除を想定していてセッションの鮮度(freshAge)を要求するが、
 * ここで消すのは連携トークンなので、連携時と同じくセッションの鮮度は問わない。
 */
export const disconnectGoogleAccount = safeAuthAction
  .metadata({ actionName: 'disconnectGoogleAccount', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    await prisma.account.deleteMany({
      where: { userId: user.id, providerId: GOOGLE_ACCOUNT_PROVIDER_ID },
    })

    logger.info({ userId: user.id }, 'google account disconnected')
    return { disconnected: true }
  })

export const getSlackStatus = safeAuthAction
  .metadata({ actionName: 'getSlackStatus', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    // 連携が利用不可なユーザーには未連携として返す(UI非表示のバックアップ)
    if (!(await canUseSlackAccount(user.id))) {
      return { connected: false }
    }
    // Slack は token レスポンスに scope を返さないので、Google のような
    // refreshToken での判定はできない。account 行の有無で連携済みとする
    const account = await prisma.account.findFirst({
      where: { userId: user.id, providerId: SLACK_PROVIDER_ID },
      select: { id: true },
    })
    return { connected: !!account }
  })
export type GetSlackStatusReturnType = Awaited<ReturnType<typeof getSlackStatus>>['data']

/** unlinkAccount を使わない理由は disconnectGoogleAccount を参照 */
export const disconnectSlack = safeAuthAction
  .metadata({ actionName: 'disconnectSlack', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    await prisma.account.deleteMany({
      where: { userId: user.id, providerId: SLACK_PROVIDER_ID },
    })

    logger.info({ userId: user.id }, 'slack account disconnected')
    return { disconnected: true }
  })

export const getNotifySettings = safeAuthAction
  .metadata({ actionName: 'getNotifySettings', role: 'user' })
  .action(async ({ ctx: { user } }) => getUserNotifySettings(user.id))

export const updateNotifySetting = safeAuthAction
  .metadata({ actionName: 'updateNotifySetting', role: 'user' })
  .inputSchema(scUpdateNotifySetting)
  .action(async ({ parsedInput: { event, ...setting }, ctx: { user } }) => {
    await setUserNotifySetting(user.id, event, setting)
    return { event, ...setting }
  })

export const setUserTimezone = safeAuthAction
  .metadata({ actionName: 'setUserTimezone', role: 'user' })
  .inputSchema(z.object({ timezone: z.string() }))
  .action(async ({ parsedInput: { timezone }, ctx: { user } }) => {
    if (!isValidTimezone(timezone)) {
      throw errValidation('timezone is not valid')
    }
    await prisma.user.update({ where: { id: user.id }, data: { timezone } })
    logger.info({ userId: user.id, timezone }, 'user timezone updated')
    return { timezone }
  })
