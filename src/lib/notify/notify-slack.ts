/**
 * Slack への配信(サーバー専用)
 *
 * DM(`U...`)とチャンネル(`C...`)は `chat.postMessage` の宛先が違うだけなので、
 * 同じ投稿処理で扱う。宛先の絞り込みは展開時(`notify-fanout.ts`)に済んでいる。
 */

import { t } from '@/locale/server'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { buildTicketMessage, SLACK_PROVIDER_ID } from '../slack/slack'
import { postSlackMessage } from '../slack/slack-server'
import type { NotifyContent } from './notify-content'
import type { DeliveryOutcome } from './notify-outcome'

/**
 * 宛先の Slack ユーザーID を引く。
 * 連携が外れていれば送る先が無いので、その配信だけを諦めさせる。
 */
const slackAccountId = async (userId: string): Promise<string | null> => {
  const account = await prisma.account.findFirst({
    where: { userId, providerId: SLACK_PROVIDER_ID },
    select: { accountId: true },
  })
  return account?.accountId ?? null
}

/**
 * 1 配信ぶんを Slack へ投稿する。
 *
 * `channel` はチャンネルID でもユーザーID でもよく、後者は Bot との DM になる。
 */
export const deliverSlack = async (param: {
  userId: string | null
  slackChannelId: string | null
  content: NotifyContent
  locale: string | null
}): Promise<DeliveryOutcome> => {
  const { userId, slackChannelId, content, locale } = param

  const channel = slackChannelId ?? (userId ? await slackAccountId(userId) : null)
  if (!channel) {
    logger.warn({ userId }, 'slack notify skipped by unlinked account')
    return 'unlinked'
  }

  const { subject, url, body, excerpt } = content
  return postSlackMessage(
    channel,
    buildTicketMessage({
      subject,
      url,
      body,
      excerpt,
      openLabel: t(locale, 'slack_msg_open_ticket'),
    }),
  )
}
