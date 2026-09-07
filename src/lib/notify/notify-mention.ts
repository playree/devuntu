/**
 * メンション通知
 *
 * 通知手段を差し込むための単一の入口。呼び出し元(チケット作成 / 本文編集 /
 * コメント投稿 / コメント編集)はこの関数だけを見ている。
 *
 * ここで行うのはキューへの投入までで、宛先の絞り込みと送信は配信ワーカー
 * (`notify-dispatch.ts`)が行う。文面に出すもの(メンションした人の名前・コメントの抜粋)は
 * 投入時に確定させる。配信は遅れて走るため、そのときにコメントが消えていることもある。
 */

import { extractMentionEmails, normalizeMentionText } from '../board/task'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { commentExcerpt } from './notify'
import { enqueueNotify } from './notify-enqueue'

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

export const notifyMention = async (param: MentionNotification): Promise<void> => {
  const { ticketId, displayId, ticketTitle, commentId, commentContent, fromUserId, toUserIds } = param

  // 自分の書き込みが自分へ通知されないようにする
  const targetUserIds = toUserIds.filter((userId) => userId !== fromUserId)
  if (targetUserIds.length === 0) {
    return
  }

  logger.info({ ticketId, displayId, commentId, fromUserId, targetUserIds }, 'mention notify')

  const from = await prisma.user.findUnique({ where: { id: fromUserId }, select: { name: true } })
  const excerpt = commentContent ? commentExcerpt(commentContent, await resolveMentionNames(commentContent)) : ''

  await enqueueNotify({
    event: 'mention',
    actorId: fromUserId,
    targetUserIds,
    payload: {
      ticketId,
      displayId,
      ticketTitle,
      fromName: from?.name ?? '',
      ...(commentId && { commentId }),
      // 記法を落とした結果が空になることもあるので、その場合は無かったことにする
      ...(excerpt && { excerpt }),
    },
  })
}
