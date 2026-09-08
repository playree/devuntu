/**
 * メールへの配信(サーバー専用)
 *
 * 送信の前提(`MAIL_SEND` の構成・通知 ON)は展開時(`notify-fanout.ts`)に確認済みなので、
 * ここでは宛先のアドレスを引いて送るだけ。
 *
 * 配信時刻はウィンドウ境界へ丸められているため、同じ区間の通知は 1 回の取り出しで
 * 同じユーザーにまとまって渡ってくる。**1 通のメールへ畳むのがこのファイルの役目**。
 */

import { t } from '@/locale/server'
import { envu } from '../env-util'
import { logger } from '../logger'
import { sendEmail } from '../mail'
import { prisma } from '../prisma'
import { MAX_DIGEST_ITEMS } from './notify'
import type { NotifyContent } from './notify-content'
import type { DeliveryOutcome } from './notify-outcome'

/** 宛先ユーザーのメールアドレスと文面のロケール */
export type MailRecipient = { id: string; email: string; locale: string | null }

export const findMailRecipient = async (userId: string): Promise<MailRecipient | null> =>
  prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, locale: true } })

/**
 * 1 件だけの通知。
 *
 * 件名は `[表示ID] チケット名` をそのまま使う。受け取った側が本文を開かずに
 * どのチケットの話かを判別できるようにするため、集約時とは違って畳まない。
 */
const single = (content: NotifyContent, locale: string | null) => {
  const { subject, body: message, url, excerpt } = content
  return {
    subject,
    text: excerpt
      ? t(locale, 'mail_notify_excerpt_body', { message, subject, excerpt, url })
      : t(locale, 'mail_notify_body', { message, subject, url }),
  }
}

/**
 * 複数件をまとめた 1 通。
 *
 * どのチケットの話か 1 件に絞れないので、件名は件数だけを示す。
 * 載せる項目は `MAX_DIGEST_ITEMS` で頭打ちにし、超過分は「ほか N 件」の 1 行へ畳む
 * (通知が溜まったときに本文が際限なく伸びないようにする)。
 */
const digest = (contents: NotifyContent[], locale: string | null) => {
  const shown = contents.slice(0, MAX_DIGEST_ITEMS)
  const items = shown.map(({ subject, body: message, url, excerpt }) =>
    excerpt
      ? t(locale, 'mail_digest_item_excerpt', { message, subject, excerpt, url })
      : t(locale, 'mail_digest_item', { message, subject, url }),
  )

  const rest = contents.length - shown.length
  if (rest > 0) {
    items.push(t(locale, 'mail_digest_more', { count: rest }))
  }

  const count = contents.length
  return {
    subject: t(locale, 'mail_digest_subject', { appname: envu.server.NEXT_PUBLIC_APP_NAME, count }),
    text: t(locale, 'mail_digest_body', { count, items: items.join('\n\n') }),
  }
}

/**
 * 1 ユーザーぶんの通知をまとめて 1 通で送る。
 *
 * 送れなかった理由(構成ミス / 一時障害)は切り分けられないので、再試行に任せる。
 * 1 通の失敗で他のユーザーを巻き添えにしないよう、例外は呼び出し元へ伝えない。
 */
export const deliverEmail = async (param: {
  recipient: MailRecipient
  contents: NotifyContent[]
}): Promise<DeliveryOutcome> => {
  const { recipient, contents } = param
  if (contents.length === 0) {
    return 'ok'
  }

  const { locale } = recipient
  const { subject, text } = contents.length === 1 ? single(contents[0], locale) : digest(contents, locale)

  try {
    // 件名・本文は利用者の入力(チケット名・抜粋)を含むためログには出さない
    logger.info({ userId: recipient.id, count: contents.length }, 'mail notify')
    await sendEmail({ to: recipient.email, subject, text })
    return 'ok'
  } catch (error) {
    logger.error({ error, userId: recipient.id }, 'mail notify failed')
    return 'retryable'
  }
}
