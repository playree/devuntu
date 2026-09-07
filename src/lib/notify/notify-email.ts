/**
 * メールへの配信(サーバー専用)
 *
 * 送信の前提(`MAIL_SEND` の構成・通知 ON)は展開時(`notify-fanout.ts`)に確認済みなので、
 * ここでは宛先のアドレスを引いて送るだけ。
 */

import { logger } from '../logger'
import { sendMentionMail } from '../mail'
import { prisma } from '../prisma'
import type { NotifyContent } from './notify-content'
import type { DeliveryOutcome } from './notify-outcome'

/** 宛先ユーザーのメールアドレスと文面のロケール */
export type MailRecipient = { id: string; email: string; locale: string | null }

export const findMailRecipient = async (userId: string): Promise<MailRecipient | null> =>
  prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, locale: true } })

/**
 * 1 配信ぶんをメールで送る。
 *
 * NOTE: 文面の組み立ては `mail.ts` の `sendMentionMail()` に残っている。
 * 集約(1 通へまとめる)を入れる段でイベント非依存な形へ移す。
 */
export const deliverEmail = async (param: {
  recipient: MailRecipient
  content: NotifyContent
}): Promise<DeliveryOutcome> => {
  const { recipient, content } = param
  const { subject, url, body, excerpt } = content

  try {
    await sendMentionMail({ locale: recipient.locale, to: recipient.email, subject, message: body, url, excerpt })
    return 'ok'
  } catch (error) {
    // 送信できない理由(構成ミス / 一時障害)を切り分けられないので、再試行に任せる
    logger.error({ error, userId: recipient.id }, 'mail notify failed')
    return 'retryable'
  }
}
