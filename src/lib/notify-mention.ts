/**
 * メンション通知(未実装)
 *
 * 将来メール / Push などを差し込むための単一の入口。現状は監査ログのみを出す。
 * 通知手段を追加する場合はこの関数の中だけを変更すれば済むようにしておく。
 */

import { logger } from './logger'

export type MentionNotification = {
  ticketId: string
  /** 利用者向けの表示ID(`KEY-番号`)。件名など人が読む箇所の識別子に使う */
  displayId: string
  ticketTitle: string
  commentId: string
  /** コメントを投稿したユーザー */
  fromUserId: string
  /** メンションされたユーザー(解決済み) */
  toUserIds: string[]
}

/**
 * 通知の見出し。メールの件名にもそのまま使えるよう表示IDを先頭に置く。
 * 受け取った側が本文を開かなくても、どのチケットの話かを判別できるようにするのが狙い。
 */
export const mentionSubject = ({ displayId, ticketTitle }: Pick<MentionNotification, 'displayId' | 'ticketTitle'>) =>
  `[${displayId}] ${ticketTitle}`

export const notifyMention = async ({
  ticketId,
  displayId,
  ticketTitle,
  commentId,
  fromUserId,
  toUserIds,
}: MentionNotification): Promise<void> => {
  if (toUserIds.length === 0) {
    return
  }

  logger.info(
    { ticketId, displayId, subject: mentionSubject({ displayId, ticketTitle }), commentId, fromUserId, toUserIds },
    'mention notify (not implemented)',
  )
}
