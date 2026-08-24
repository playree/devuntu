'use server'

import { safeAuthAction } from '@/lib/action-server'
import { removeImageAttachment, saveImageAttachment } from '@/lib/attachment'
import { auth } from '@/lib/auth'
import { isValidTimezone, nowDate } from '@/lib/day'
import { errNotFound, errValidation } from '@/lib/error'
import { canUseGoogleAccount, googleAccountQuery } from '@/lib/google/google-account'
import { GOOGLE_ACCOUNT_PROVIDER_ID } from '@/lib/google/google-calendar'
import { logger } from '@/lib/logger'
import { getUserNotifySettings, setUserNotifySetting } from '@/lib/notify/notify-setting'
import { dedupeScopes } from '@/lib/oauth/oauth-consent'
import { prisma } from '@/lib/prisma'
import { scRevokeConsent, scSetUserAvatar, scUpdateNotifySetting } from '@/lib/schema'
import { SLACK_PROVIDER_ID } from '@/lib/slack/slack'
import { canUseSlackAccount } from '@/lib/slack/slack-account'
import { headers } from 'next/headers'
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

export const getMyOAuthConsents = safeAuthAction
  .metadata({ actionName: 'getMyOAuthConsents', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    // auth.api.getOAuthConsents はクライアント名を返さないので、リレーションを辿れる Prisma で1クエリにする
    const consents = await prisma.oauthConsent.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        scopes: true,
        updatedAt: true,
        oauthclient: { select: { clientId: true, name: true } },
      },
    })
    return consents.map(({ id, scopes, updatedAt, oauthclient }) => ({
      id,
      clientId: oauthclient.clientId,
      clientName: oauthclient.name ?? '',
      scopes: dedupeScopes(scopes),
      updatedAt,
    }))
  })
export type GetMyOAuthConsentsReturnType = Awaited<ReturnType<typeof getMyOAuthConsents>>['data']

/**
 * 許可済みアプリの取り消し。
 * 同意行を消すだけでは発行済みのアクセス/リフレッシュトークンは有効なままなので、
 * 対象クライアント宛のトークンも失効させて「取り消し」と実際の権限を一致させる。
 *
 * トークンの失効を先に済ませてから同意行を消す。途中で落ちた場合に
 * 「同意は消えたのにトークンは有効」という権限が残る側の中間状態を作らないため。
 */
export const revokeOAuthConsent = safeAuthAction
  .metadata({ actionName: 'revokeOAuthConsent', role: 'user' })
  .inputSchema(scRevokeConsent)
  .action(async ({ parsedInput: { id }, ctx: { user } }) => {
    const consent = await prisma.oauthConsent.findUnique({ where: { id }, select: { userId: true, clientId: true } })
    if (!consent || consent.userId !== user.id) {
      throw errNotFound()
    }

    const revoked = nowDate()
    const where = { userId: user.id, clientId: consent.clientId, revoked: null }
    const [accessTokens, refreshTokens] = await prisma.$transaction([
      prisma.oauthAccessToken.updateMany({ where, data: { revoked } }),
      prisma.oauthRefreshToken.updateMany({ where, data: { revoked } }),
    ])

    await auth.api.deleteOAuthConsent({ headers: await headers(), body: { id } })

    logger.info(
      {
        userId: user.id,
        clientId: consent.clientId,
        accessTokens: accessTokens.count,
        refreshTokens: refreshTokens.count,
      },
      'oauth consent revoked',
    )
    return { id }
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

/**
 * アバター更新。
 * 画像アップロード時は独自アバターとみなしOIDC同期を止める。null指定は独自アバターを削除して同期を再開する
 */
export const setUserAvatar = safeAuthAction
  .metadata({ actionName: 'setUserAvatar', role: 'user' })
  .inputSchema(scSetUserAvatar)
  .action(async ({ parsedInput: { image }, ctx: { user } }) => {
    const existing = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { image: true } })

    if (image === null) {
      await prisma.user.update({ where: { id: user.id }, data: { image: null, avatarLocked: false } })
      if (existing.image) {
        await removeImageAttachment(existing.image)
      }
      logger.info({ userId: user.id }, 'user avatar removed')
      return { image: null }
    }

    const url = await saveImageAttachment(image, user.id)
    try {
      await prisma.user.update({ where: { id: user.id }, data: { image: url, avatarLocked: true } })
    } catch (err) {
      // 更新に失敗した場合は新規保存分を残さない
      await removeImageAttachment(url)
      throw err
    }
    if (existing.image) {
      await removeImageAttachment(existing.image)
    }
    logger.info({ userId: user.id }, 'user avatar updated')
    return { image: url }
  })
