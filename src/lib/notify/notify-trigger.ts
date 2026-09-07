/**
 * 通知トリガーの発火(サーバー専用)
 *
 * 業務イベント(チケットの作成・更新・コメント・エージェントの実行終了)から、
 * 発火すべき通知をすべて投入する。**Server Action と MCP の両方から呼ぶ唯一の入口**で、
 * どの条件でどのイベントを発火するかの判断はこのファイルに閉じる。
 *
 * 同じ操作が Web と MCP の 2 系統にあるため、判断を呼び出し元に書くと必ず片方が漏れる。
 * トリガーを増やすときに触るのはこのファイルだけで済むようにしてある。
 *
 * 文面に出すもの(操作した人の名前・コメントの抜粋)は投入時に確定させる。配信は遅れて走るため、
 * そのときにはコメントやチケットが消えていることもある。
 */

import type { AgentRunAction, AgentRunStatus } from '@/generated/prisma/enums'
import { extractMentionEmails, normalizeMentionText } from '../board/task'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { commentExcerpt } from './notify'
import { enqueueNotify } from './notify-enqueue'

/** 通知に載せるチケットの識別。表示IDは呼び出し元で組み立てて渡す */
export type TicketNotifyRef = {
  id: string
  displayId: string
  title: string
}

/** 通知の判断に使うチケットの状態。`assertTicketAccess()` の戻り(`TicketAccess`)からそのまま作れる */
export type TicketNotifyState = {
  assigneeId: string | null
}

/** 操作した人の表示名。文面の「〇〇さんが…」に出す */
const actorName = async (actorId: string): Promise<string> => {
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } })
  return actor?.name ?? ''
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

/**
 * メンション通知。
 *
 * 宛先は呼び出し元が渡す「増えた分」だけ(本文を編集し直すたびに同じ相手へ通知しない)。
 * 自分の書き込みで自分に通知が飛ばないよう、操作した本人は除く。
 */
const enqueueMentioned = async (param: {
  actorId: string
  ticket: TicketNotifyRef
  userIds: string[]
  /** コメント経由のメンションのみ。抜粋の元にもする */
  comment?: { id: string; content: string }
}): Promise<void> => {
  const { actorId, ticket, comment } = param
  const targetUserIds = param.userIds.filter((userId) => userId !== actorId)
  if (targetUserIds.length === 0) {
    return
  }

  logger.info({ ticketId: ticket.id, commentId: comment?.id, actorId, targetUserIds }, 'mention notify')

  const excerpt = comment ? commentExcerpt(comment.content, await resolveMentionNames(comment.content)) : ''

  await enqueueNotify({
    event: 'mention',
    actorId,
    targetUserIds,
    payload: {
      ticketId: ticket.id,
      displayId: ticket.displayId,
      ticketTitle: ticket.title,
      fromName: await actorName(actorId),
      ...(comment && { commentId: comment.id }),
      // 記法を落とした結果が空になることもあるので、その場合は無かったことにする
      ...(excerpt && { excerpt }),
    },
  })
}

/**
 * 担当者に指定されたことの通知。
 *
 * 送るのは担当が実際に変わったときだけ。自分で自分を担当にした場合と、
 * 担当がエージェント用ユーザーの場合(DM を読まない)は送らない。
 */
const enqueueAssigned = async (param: {
  actorId: string
  ticket: TicketNotifyRef
  before: string | null
  after: string | null
}): Promise<void> => {
  const { actorId, ticket, before, after } = param
  if (!after || after === before || after === actorId) {
    return
  }

  const assignee = await prisma.user.findUnique({ where: { id: after }, select: { isAgent: true } })
  if (!assignee || assignee.isAgent) {
    return
  }

  logger.info({ ticketId: ticket.id, actorId, assigneeId: after }, 'ticket assigned notify')

  await enqueueNotify({
    event: 'ticket_assigned',
    actorId,
    targetUserIds: [after],
    payload: {
      ticketId: ticket.id,
      displayId: ticket.displayId,
      ticketTitle: ticket.title,
      fromName: await actorName(actorId),
    },
  })
}

/**
 * チケット作成。
 *
 * 作成時に担当者を付けるのも「担当者に指定された」ことなので、更新時と同じ扱いにする
 * (`before` が無い状態からの変更とみなす)。
 */
export const enqueueTicketCreated = async (param: {
  actorId: string
  ticket: TicketNotifyRef
  assigneeId: string | null
  mentionedUserIds: string[]
}): Promise<void> => {
  const { actorId, ticket, assigneeId, mentionedUserIds } = param
  await enqueueMentioned({ actorId, ticket, userIds: mentionedUserIds })
  await enqueueAssigned({ actorId, ticket, before: null, after: assigneeId })
}

/**
 * チケット更新。前後の状態から発火すべきイベントを判断する。
 *
 * 新しいトリガーを足すときに触るのはこの関数で、呼び出し元(Server Action / MCP)は変わらない。
 */
export const enqueueTicketUpdated = async (param: {
  actorId: string
  ticket: TicketNotifyRef
  before: TicketNotifyState
  after: TicketNotifyState
  /** 本文の編集で増えたメンション。本文を触らない更新では空 */
  addedMentionUserIds: string[]
}): Promise<void> => {
  const { actorId, ticket, before, after, addedMentionUserIds } = param
  await enqueueMentioned({ actorId, ticket, userIds: addedMentionUserIds })
  await enqueueAssigned({ actorId, ticket, before: before.assigneeId, after: after.assigneeId })
}

/** コメントの投稿・編集。コメント経由のメンションだけを発火する */
export const enqueueTicketCommented = async (param: {
  actorId: string
  ticket: TicketNotifyRef
  comment: { id: string; content: string }
  addedMentionUserIds: string[]
}): Promise<void> => {
  const { actorId, ticket, comment, addedMentionUserIds } = param
  await enqueueMentioned({ actorId, ticket, userIds: addedMentionUserIds, comment })
}

/**
 * エージェントの実行終了。
 *
 * 呼び出し元は実行を閉じる 3 経路(`agent-runner.ts`)。宛先は依頼者への DM
 * (`notify-recipient.ts` が解決する)と、ボードに設定があれば Slack チャンネル。
 * チャンネル未設定でも DM は送るので、ここでは宛先の有無で分岐しない。
 */
export type AgentRunNotification = {
  /** 通知先チャンネル。null ならチャンネルへは投稿しない */
  slackChannelId: string | null
  runId: string
  /** 実行したエージェントの表示名 */
  agentName: string
  /** 対象チケット。削除済みの実行は通知しないので必須 */
  ticket: TicketNotifyRef
  action: AgentRunAction
  /** 終了時のみ通知するので、実行中は受け取らない */
  status: Exclude<AgentRunStatus, 'running'>
  /** エージェントが報告した結果の要約 */
  summary: string | null
  startedAt: Date
  finishedAt: Date
}

export const enqueueAgentRunFinished = async (param: AgentRunNotification): Promise<void> => {
  const { slackChannelId, runId, agentName, ticket, action, status, summary, startedAt, finishedAt } = param
  const excerpt = summary ? commentExcerpt(summary) : ''

  logger.info({ runId, ticketId: ticket.id, status }, 'agent run notify')

  await enqueueNotify({
    event: 'agent_run',
    // 実行はエージェントが行うが、DM の宛先は依頼者なので actor は置かない
    targetSlackChannelIds: slackChannelId ? [slackChannelId] : [],
    payload: {
      ticketId: ticket.id,
      displayId: ticket.displayId,
      ticketTitle: ticket.title,
      runId,
      agentName,
      action,
      status,
      startedAt,
      finishedAt,
      // 記法を落とした結果が空になることもあるので、その場合は無かったことにする
      ...(excerpt && { excerpt }),
    },
  })
}
