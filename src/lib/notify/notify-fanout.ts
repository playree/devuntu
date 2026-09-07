/**
 * アウトボックスの展開(サーバー専用)
 *
 * 「何が起きたか」1行から「誰へ / どのチャンネルへ / どのチャネルで」の配信行を作る。
 * 送らない相手はここで消える(通知OFF / 未連携 / 許可グループ外 / 未構成)ので、
 * 配信側は残った行を送るだけでよく、通知しないこと自体はエラーにならない。
 */

import type { Prisma } from '@/generated/prisma/client'
import type { NotifyEvent } from '@/generated/prisma/enums'
import { nowDate } from '../day'
import { logger } from '../logger'
import { isMailConfigured } from '../mail'
import { prisma } from '../prisma'
import { SLACK_PROVIDER_ID } from '../slack/slack'
import { filterSlackAllowedUserIds, getSlackSettings, hasSlackCredentials } from '../slack/slack-account'
import { isWebPushConfigured } from '../webpush/webpush-server'
import { MAX_NOTIFY_RECIPIENTS, type NotifyChannel } from './notify'
import type { NotifyTargets } from './notify-recipient'
import { nextEmailWindowAt } from './notify-schedule'
import { filterNotifiable } from './notify-setting'

/** 作る配信行。`createMany` へそのまま渡す */
type DeliveryInput = {
  outboxId: string
  channel: NotifyChannel
  userId?: string
  slackChannelId?: string
  scheduledAt: Date
}

/**
 * 上限で切り詰める。誰が落ちるかが実行ごとに変わらないよう、呼び出し側で順序を固定しておく。
 * 超過分は警告ログのみで、通知の失敗としては扱わない(暴走時の歯止めが目的)。
 */
const capRecipients = <T>(items: T[], label: string, context: object): T[] => {
  if (items.length <= MAX_NOTIFY_RECIPIENTS) {
    return items
  }
  logger.warn({ ...context, total: items.length, sent: MAX_NOTIFY_RECIPIENTS }, `${label} recipients truncated`)
  return items.slice(0, MAX_NOTIFY_RECIPIENTS)
}

/**
 * メール通知を受け取るユーザーへ絞る。
 * Slack と違い連携作業が要らないので、通知 OFF のユーザーを外すだけで宛先が決まる。
 */
const emailTargets = async (userIds: string[], event: NotifyEvent): Promise<string[]> => {
  if (userIds.length === 0 || !isMailConfigured()) {
    return []
  }
  const notMuted = await filterNotifiable(userIds, event, 'email')
  if (notMuted.length === 0) {
    return []
  }
  // 切り詰めの順序を固定するため、宛先の並びを id 順に揃える
  const recipients = await prisma.user.findMany({
    where: { id: { in: notMuted } },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  return recipients.map(({ id }) => id)
}

/**
 * Slack DM を受け取るユーザーへ絞る。
 *
 * 通知 OFF / 管理者の無効化・許可グループ外 / 未連携 のいずれかで宛先から消える。
 * 未連携をここで外すのは、送っても必ず `unlinked` になる行を作らないため。
 */
const slackDmTargets = async (userIds: string[], event: NotifyEvent): Promise<string[]> => {
  if (userIds.length === 0) {
    return []
  }
  const notMuted = await filterNotifiable(userIds, event, 'slack')
  const allowed = await filterSlackAllowedUserIds(notMuted)
  if (allowed.length === 0) {
    return []
  }
  const accounts = await prisma.account.findMany({
    where: { userId: { in: allowed }, providerId: SLACK_PROVIDER_ID },
    select: { userId: true },
    // 切り詰めの順序を固定する
    orderBy: { id: 'asc' },
  })
  return accounts.map(({ userId }) => userId)
}

/**
 * Web プッシュを受け取るユーザーへ絞る。
 *
 * 通知 OFF / 未構成 / 端末を 1 つも登録していない のいずれかで宛先から消える。
 * 購読が無い相手を外すのは、送っても必ず失敗する行を作らないため。
 */
const webPushTargets = async (userIds: string[], event: NotifyEvent): Promise<string[]> => {
  if (userIds.length === 0 || !isWebPushConfigured()) {
    return []
  }
  const notMuted = await filterNotifiable(userIds, event, 'webpush')
  if (notMuted.length === 0) {
    return []
  }
  const subscribed = await prisma.webPushSubscription.findMany({
    where: { userId: { in: notMuted } },
    select: { userId: true },
    distinct: ['userId'],
    // 切り詰めの順序を固定する
    orderBy: { userId: 'asc' },
  })
  return subscribed.map(({ userId }) => userId)
}

/**
 * 展開する配信行を組み立てる。
 *
 * `scheduledAt` は即時が既定で、**メールだけ次のウィンドウ境界へ丸める**。
 * 同じ区間に発生した通知が同じ時刻へ寄るので、配信側でユーザー単位に 1 通へまとめられる。
 */
export const buildDeliveries = async (param: {
  outboxId: string
  event: NotifyEvent
  /** 発生させた人。自分の操作で自分へ通知しないよう DM の宛先から外す */
  actorId: string | null
  targets: NotifyTargets
  now?: Date
}): Promise<DeliveryInput[]> => {
  const { outboxId, event, actorId, targets, now = nowDate() } = param
  const deliveries: DeliveryInput[] = []
  const emailAt = nextEmailWindowAt(now)

  /**
   * 規則で導く宛先(依頼者など)は宛先解決の時点で actor を知らないため、ここで一律に外す。
   * トリガー側で渡す宛先も同じ扱いになるので、除外の判断がこの 1 箇所に揃う。
   */
  const userIds = targets.userIds.filter((userId) => userId !== actorId)

  const [emailUserIds, slackUserIds, webPushUserIds] = await Promise.all([
    emailTargets(userIds, event),
    slackDmTargets(userIds, event),
    webPushTargets(userIds, event),
  ])

  for (const userId of capRecipients(emailUserIds, 'mail', { outboxId, event })) {
    deliveries.push({ outboxId, channel: 'email', userId, scheduledAt: emailAt })
  }
  for (const userId of capRecipients(slackUserIds, 'slack dm', { outboxId, event })) {
    deliveries.push({ outboxId, channel: 'slack', userId, scheduledAt: now })
  }
  for (const userId of capRecipients(webPushUserIds, 'web push', { outboxId, event })) {
    deliveries.push({ outboxId, channel: 'webpush', userId, scheduledAt: now })
  }

  // チャンネル通知は管理者が Slack 連携ごと止めたら止まる(ユーザーの通知設定では表せない)
  if (targets.slackChannelIds.length > 0 && hasSlackCredentials()) {
    const { enabled } = await getSlackSettings()
    if (enabled) {
      const channels = capRecipients([...targets.slackChannelIds].sort(), 'slack channel', { outboxId, event })
      for (const slackChannelId of channels) {
        deliveries.push({ outboxId, channel: 'slack', slackChannelId, scheduledAt: now })
      }
    }
  }

  return deliveries
}

/** 展開した配信行を保存する。宛先が 1 つも残らなかった場合は何も作らない */
export const createDeliveries = async (
  deliveries: DeliveryInput[],
  tx: Prisma.TransactionClient = prisma,
): Promise<number> => {
  if (deliveries.length === 0) {
    return 0
  }
  const { count } = await tx.notifyDelivery.createMany({ data: deliveries })
  return count
}
