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
import { isMailConfigured, sendMentionMail } from './mail'
import { commentExcerpt, MAX_NOTIFY_RECIPIENTS } from './notify'
import { filterNotifiable } from './notify-setting'
import { prisma } from './prisma'
import { makeUrl } from './server-utils'
import { buildMentionMessage, SLACK_PROVIDER_ID } from './slack'
import { filterSlackAllowedUserIds } from './slack-account'
import { postSlackDm } from './slack-server'
import { commentAnchorId, extractMentionEmails, normalizeMentionText, ticketShortPath } from './task'

export type MentionNotification = {
  ticketId: string
  /** 利用者向けの表示ID(`KEY-番号`)。件名など人が読む箇所の識別子に使う */
  displayId: string
  ticketTitle: string
  /** コメント経由のメンションのみ。チケット本文のメンションでは省略する */
  commentId?: string
  /** コメント本文(Markdown)。通知に載せる抜粋の元。commentId と対で渡す */
  commentContent?: string
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

/** チャネル間で共通の送信内容。宛先のロケールで文面が変わる部分だけ関数で持つ */
type MentionContext = {
  subject: string
  url: string
  message: (locale: string | null) => string
  /** コメント本文の抜粋。チケット本文のメンションでは持たない */
  excerpt?: string
}

/**
 * 本文中のメンションを表示名へ解決する。
 *
 * 画面(`mention-node.tsx`)は `@表示名` で描画するので、通知でも同じ見え方に揃える。
 * 引けなかったメールアドレスは画面と同じくそのまま出す。
 */
const resolveMentionNames = async (content: string): Promise<Map<string, string>> => {
  // 正規化・重複除去済み(コードブロック内のメンションも除かれている)
  const emails = extractMentionEmails(content)
  if (emails.length === 0) {
    return new Map()
  }

  const users = await prisma.user.findMany({
    // 保存されている大文字小文字に依存しないよう、正規化した形と突き合わせる
    where: { OR: emails.map((email) => ({ email: { equals: email, mode: 'insensitive' as const } })) },
    select: { email: true, name: true },
  })

  return new Map(users.map(({ email, name }) => [normalizeMentionText(email), name]))
}

const buildMentionContext = async ({
  displayId,
  ticketTitle,
  commentId,
  commentContent,
  fromUserId,
}: MentionNotification): Promise<MentionContext> => {
  const from = await prisma.user.findUnique({ where: { id: fromUserId }, select: { name: true } })
  const fromName = from?.name ?? ''

  // コメント宛のときだけ、該当コメントの位置まで開けるようフラグメントを付ける
  const path = commentId ? `${ticketShortPath(displayId)}#${commentAnchorId(commentId)}` : ticketShortPath(displayId)
  const excerpt = commentContent ? commentExcerpt(commentContent, await resolveMentionNames(commentContent)) : ''

  return {
    subject: mentionSubject({ displayId, ticketTitle }),
    url: makeUrl(path).toString(),
    message: (locale) =>
      t(locale, commentId ? 'notify_msg_mentioned_comment' : 'notify_msg_mentioned', { from: fromName }),
    // 記法を落とした結果が空になることもあるので、その場合は無かったことにする
    ...(excerpt && { excerpt }),
  }
}

/**
 * 通知 ON の宛先へメールを送る。
 *
 * Slack と違い連携作業が要らないので、通知 OFF のユーザーを外すだけで宛先が決まる。
 */
const notifyMentionByEmail = async (
  targets: string[],
  { subject, url, message, excerpt }: MentionContext,
): Promise<void> => {
  if (!isMailConfigured()) {
    return
  }

  const notMuted = await filterNotifiable(targets, 'mention', 'email')
  if (notMuted.length === 0) {
    return
  }

  const recipients = await prisma.user.findMany({
    where: { id: { in: notMuted } },
    select: { id: true, email: true, locale: true },
    // 上限で切り詰めるため、誰が落ちるかが実行ごとに変わらないよう順序を固定する
    orderBy: { id: 'asc' },
  })

  const sendTo = recipients.slice(0, MAX_NOTIFY_RECIPIENTS)
  if (recipients.length > sendTo.length) {
    logger.warn({ total: recipients.length, sent: sendTo.length }, 'mail mention recipients truncated')
  }

  for (const { id, email, locale } of sendTo) {
    try {
      await sendMentionMail({ locale, to: email, subject, message: message(locale), url, excerpt })
    } catch (error) {
      // 1 通の失敗で残りの宛先を巻き添えにしない
      logger.error({ error, userId: id }, 'mail mention failed')
    }
  }
}

/**
 * Slack 連携済みの宛先へ DM を送る。
 *
 * 宛先はここまでの各段階で絞り込まれ、条件を満たさない相手は自然に消える
 * (未連携 / 通知OFF / 許可グループ外)。通知しないこと自体はエラーではない。
 */
const notifyMentionToSlack = async (
  targets: string[],
  { subject, url, message, excerpt }: MentionContext,
): Promise<void> => {
  const notMuted = await filterNotifiable(targets, 'mention', 'slack')
  const allowed = await filterSlackAllowedUserIds(notMuted)
  if (allowed.length === 0) {
    return
  }

  const accounts = await prisma.account.findMany({
    where: { userId: { in: allowed }, providerId: SLACK_PROVIDER_ID },
    select: { userId: true, accountId: true },
    // 上限で切り詰めるため、誰が落ちるかが実行ごとに変わらないよう順序を固定する
    orderBy: { id: 'asc' },
  })
  if (accounts.length === 0) {
    return
  }

  // 宛先が多くても Slack を叩き続けないよう頭打ちにする
  const sendTo = accounts.slice(0, MAX_NOTIFY_RECIPIENTS)
  if (accounts.length > sendTo.length) {
    logger.warn({ total: accounts.length, sent: sendTo.length }, 'slack mention recipients truncated')
  }

  const recipients = await prisma.user.findMany({
    where: { id: { in: sendTo.map(({ userId }) => userId) } },
    select: { id: true, locale: true },
  })
  const localeByUserId = new Map(recipients.map(({ id, locale }) => [id, locale]))

  // 逐次送信。after の中で走るのでレスポンスは待たされず、ワークスペース単位の
  // バーストも避けられる
  for (const { userId, accountId } of sendTo) {
    const locale = localeByUserId.get(userId) ?? null
    const outcome = await postSlackDm(
      accountId,
      buildMentionMessage({
        subject,
        url,
        body: message(locale),
        excerpt,
        openLabel: t(locale, 'slack_msg_open_ticket'),
      }),
    )
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

  // 通知はチケット操作の付随処理。外部サービスとの往復でレスポンスを遅らせず、
  // 失敗もチケット操作へ波及させない
  after(async () => {
    try {
      // 自分の書き込みが自分へ通知されないようにする
      const targets = toUserIds.filter((userId) => userId !== fromUserId)
      if (targets.length === 0) {
        return
      }
      const context = await buildMentionContext(param)

      // 片方のチャネルの失敗でもう片方を止めない
      const results = await Promise.allSettled([
        notifyMentionByEmail(targets, context),
        notifyMentionToSlack(targets, context),
      ])
      for (const result of results) {
        if (result.status === 'rejected') {
          logger.error({ error: result.reason, ticketId, displayId }, 'mention notify channel failed')
        }
      }
    } catch (error) {
      logger.error({ error, ticketId, displayId }, 'mention notify failed')
    }
  })
}
