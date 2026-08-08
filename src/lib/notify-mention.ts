/**
 * メンション通知(未実装)
 *
 * 将来メール / Push などを差し込むための単一の入口。現状は監査ログのみを出す。
 * 通知手段を追加する場合はこの関数の中だけを変更すれば済むようにしておく。
 */

import { logger } from './logger'

export type MentionNotification = {
  ticketId: string
  commentId: string
  /** コメントを投稿したユーザー */
  fromUserId: string
  /** メンションされたユーザー(解決済み) */
  toUserIds: string[]
}

export const notifyMention = async ({
  ticketId,
  commentId,
  fromUserId,
  toUserIds,
}: MentionNotification): Promise<void> => {
  if (toUserIds.length === 0) {
    return
  }

  logger.info({ ticketId, commentId, fromUserId, toUserIds }, 'mention notify (not implemented)')
}
