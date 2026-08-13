/**
 * メンション通知
 *
 * 通知手段を差し込むための単一の入口。呼び出し元(チケット作成 / 本文編集 /
 * コメント投稿 / コメント編集)はこの関数だけを見ているので、手段を追加・変更する
 * 場合もこのファイルの中だけで完結させる。
 */

import { t } from '@/locale/server'
import { after } from 'next/server'
import { logger } from './logger'
import { filterSlackNotifiable } from './notify-setting'
import { prisma } from './prisma'
import { makeUrl } from './server-utils'
import { buildMentionMessage, MAX_SLACK_RECIPIENTS, SLACK_PROVIDER_ID } from './slack'
import { filterSlackAllowedUserIds } from './slack-account'
import { postSlackDm } from './slack-server'

export type MentionNotification = {
  ticketId: string
  /** 利用者向けの表示ID(`KEY-番号`)。件名など人が読む箇所の識別子に使う */
  displayId: string
  ticketTitle: string
  /** コメント経由のメンションのみ。チケット本文のメンションでは省略する */
  commentId?: string
  /** メンションした本人(コメントの投稿者 / 本文の更新者) */
  fromUserId: string
  /** メンションされたユーザー(解決済み) */
  toUserIds: string[]
}

/**
 * 通知の見出し。メールの件名にもそのまま使えるよう表示IDを先頭に置く。
 * 受け取った側が本文を開かなくても、どのチケットの話かを判別できるようにするのが狙い。
 *
 * 件名は利用者の入力を含むため、通知を送る箇所でだけ組み立てる(ログには出さない)。
 */
export const mentionSubject = ({ displayId, ticketTitle }: Pick<MentionNotification, 'displayId' | 'ticketTitle'>) =>
  `[${displayId}] ${ticketTitle}`

/**
 * Slack 連携済みの宛先へ DM を送る。
 *
 * 宛先はここまでの各段階で絞り込まれ、条件を満たさない相手は自然に消える
 * (未連携 / 通知OFF / 許可グループ外)。通知しないこと自体はエラーではない。
 */
const notifyMentionToSlack = async ({
  displayId,
  ticketTitle,
  commentId,
  fromUserId,
  toUserIds,
}: MentionNotification): Promise<void> => {
  // 自分の書き込みが自分へ DM されないようにする
  const targets = toUserIds.filter((userId) => userId !== fromUserId)
  if (targets.length === 0) {
    return
  }

  const notMuted = await filterSlackNotifiable(targets, 'mention')
  const allowed = await filterSlackAllowedUserIds(notMuted)
  if (allowed.length === 0) {
    return
  }

  const accounts = await prisma.account.findMany({
    where: { userId: { in: allowed }, providerId: SLACK_PROVIDER_ID },
    select: { userId: true, accountId: true },
  })
  if (accounts.length === 0) {
    return
  }

  const [from, recipients] = await Promise.all([
    prisma.user.findUnique({ where: { id: fromUserId }, select: { name: true } }),
    prisma.user.findMany({
      where: { id: { in: accounts.map(({ userId }) => userId) } },
      select: { id: true, locale: true },
    }),
  ])
  const localeByUserId = new Map(recipients.map(({ id, locale }) => [id, locale]))

  const subject = mentionSubject({ displayId, ticketTitle })
  const url = makeUrl(`/t/${displayId}`).toString()
  const fromName = from?.name ?? ''

  // 宛先が多くても Slack を叩き続けないよう頭打ちにする
  const sendTo = accounts.slice(0, MAX_SLACK_RECIPIENTS)
  if (accounts.length > sendTo.length) {
    logger.warn({ total: accounts.length, sent: sendTo.length }, 'slack mention recipients truncated')
  }

  // 逐次送信。after の中で走るのでレスポンスは待たされず、ワークスペース単位の
  // バーストも避けられる
  for (const { userId, accountId } of sendTo) {
    const locale = localeByUserId.get(userId) ?? null
    const message = buildMentionMessage({
      subject,
      url,
      body: t(locale, commentId ? 'slack_msg_mentioned_comment' : 'slack_msg_mentioned', { from: fromName }),
      openLabel: t(locale, 'slack_msg_open_ticket'),
    })

    const outcome = await postSlackDm(accountId, message)
    if (outcome === 'revoked') {
      // Bot トークンが無効なら残りも全滅するので打ち切る
      logger.error({ userId }, 'slack mention aborted by invalid bot token')
      break
    }
  }
}

export const notifyMention = async (param: MentionNotification): Promise<void> => {
  const { ticketId, displayId, commentId, fromUserId, toUserIds } = param
  if (toUserIds.length === 0) {
    return
  }

  logger.info({ ticketId, displayId, commentId, fromUserId, toUserIds }, 'mention notify')

  // 通知はチケット操作の付随処理。Slack との往復でレスポンスを遅らせず、
  // 失敗もチケット操作へ波及させない
  after(async () => {
    try {
      await notifyMentionToSlack(param)
    } catch (error) {
      logger.error({ error, ticketId, displayId }, 'mention notify failed')
    }
  })
}
