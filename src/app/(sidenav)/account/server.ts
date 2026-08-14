'use server'

import { safeAuthAction } from '@/lib/action-server'
import { auth } from '@/lib/auth'
import { isValidTimezone } from '@/lib/day'
import { errValidation } from '@/lib/error'
import { canUseGoogleAccount } from '@/lib/google-account'
import { GOOGLE_ACCOUNT_PROVIDER_ID } from '@/lib/google-calendar'
import { logger } from '@/lib/logger'
import { getUserNotifySettings, setUserNotifySetting } from '@/lib/notify-setting'
import { prisma } from '@/lib/prisma'
import { scUpdateNotifySetting } from '@/lib/schema'
import { SLACK_PROVIDER_ID } from '@/lib/slack'
import { canUseSlackAccount } from '@/lib/slack-account'
import { headers } from 'next/headers'
import { z } from 'zod'

/**
 * Google アカウント連携状態の取得
 */
export const getGoogleAccountStatus = safeAuthAction
  .metadata({ actionName: 'getGoogleAccountStatus', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    // 連携が利用不可なユーザーには未連携として返す(UI非表示のバックアップ)
    if (!(await canUseGoogleAccount(user.id))) {
      return { connected: false, scopes: [] as string[] }
    }
    const account = await prisma.account.findFirst({
      where: { userId: user.id, providerId: GOOGLE_ACCOUNT_PROVIDER_ID },
      select: { scope: true, refreshToken: true },
    })
    // リフレッシュトークンが無い場合は未連携扱い
    const connected = !!account?.refreshToken
    return {
      connected,
      scopes: connected ? (account?.scope?.split(',').filter(Boolean) ?? []) : [],
    }
  })
export type GetGoogleAccountStatusReturnType = Awaited<ReturnType<typeof getGoogleAccountStatus>>['data']

/**
 * Google アカウント連携の解除
 */
export const disconnectGoogleAccount = safeAuthAction
  .metadata({ actionName: 'disconnectGoogleAccount', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    await auth.api.unlinkAccount({
      body: { providerId: GOOGLE_ACCOUNT_PROVIDER_ID },
      headers: await headers(),
    })

    logger.info({ userId: user.id }, 'google account disconnected')
    return { disconnected: true }
  })

/**
 * Slack 連携状態の取得
 */
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

/**
 * Slack 連携の解除
 */
export const disconnectSlack = safeAuthAction
  .metadata({ actionName: 'disconnectSlack', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    await auth.api.unlinkAccount({
      body: { providerId: SLACK_PROVIDER_ID },
      headers: await headers(),
    })

    logger.info({ userId: user.id }, 'slack account disconnected')
    return { disconnected: true }
  })

/**
 * 通知設定(イベント種別ごと・チャネルごとの ON/OFF)の取得
 */
export const getNotifySettings = safeAuthAction
  .metadata({ actionName: 'getNotifySettings', role: 'user' })
  .action(async ({ ctx: { user } }) => getUserNotifySettings(user.id))

/**
 * 通知設定の更新
 */
export const updateNotifySetting = safeAuthAction
  .metadata({ actionName: 'updateNotifySetting', role: 'user' })
  .inputSchema(scUpdateNotifySetting)
  .action(async ({ parsedInput: { event, ...setting }, ctx: { user } }) => {
    await setUserNotifySetting(user.id, event, setting)
    return { event, ...setting }
  })

/**
 * ユーザーのタイムゾーン設定を更新する
 */
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
