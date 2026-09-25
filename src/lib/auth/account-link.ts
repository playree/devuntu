/**
 * 外部アカウント連携(Google / Slack)の状態取得と解除(サーバー専用)
 */

import { canUseGoogleAccount, googleAccountQuery } from '../google/google-account'
import { GOOGLE_ACCOUNT_PROVIDER_ID } from '../google/google-calendar'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { SLACK_PROVIDER_ID } from '../slack/slack'
import { canUseSlackAccount } from '../slack/slack-account'

/** Google 連携の状態。連携が利用不可なユーザーには未連携として返す(UI非表示のバックアップ) */
export const getGoogleAccountStatus = async (userId: string) => {
  if (!(await canUseGoogleAccount(userId))) {
    return { connected: false, scopes: [] as string[] }
  }
  // googleAccountQuery が refresh token を持つ行だけに絞るので、行の有無が連携済みかどうか
  const account = await prisma.account.findFirst({
    ...googleAccountQuery(userId),
    select: { scope: true },
  })
  const connected = !!account
  return {
    connected,
    scopes: connected ? (account?.scope?.split(',').filter(Boolean) ?? []) : [],
  }
}

/** Slack 連携の状態。連携が利用不可なユーザーには未連携として返す(UI非表示のバックアップ) */
export const getSlackAccountStatus = async (userId: string) => {
  if (!(await canUseSlackAccount(userId))) {
    return { connected: false }
  }
  // Slack は token レスポンスに scope を返さないので、Google のような
  // refreshToken での判定はできない。account 行の有無で連携済みとする
  const account = await prisma.account.findFirst({
    where: { userId, providerId: SLACK_PROVIDER_ID },
    select: { id: true },
  })
  return { connected: !!account }
}

/**
 * 連携の解除。better-auth の unlinkAccount は使わない。
 * あちらはログイン資格情報の削除を想定していてセッションの鮮度(freshAge)を要求するが、
 * ここで消すのは連携トークンなので、連携時と同じくセッションの鮮度は問わない。
 */
export const disconnectAccount = async (userId: string, provider: 'google' | 'slack') => {
  const providerId = provider === 'google' ? GOOGLE_ACCOUNT_PROVIDER_ID : SLACK_PROVIDER_ID
  await prisma.account.deleteMany({ where: { userId, providerId } })

  logger.info({ userId }, `${provider} account disconnected`)
}
