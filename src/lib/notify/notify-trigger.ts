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
 *
 * どのトリガーも**業務更新と同じトランザクションで呼ぶ**(`tx` を渡す)。コミット後に投入すると、
 * その間にプロセスが落ちた場合に操作だけが残って通知が消える。文面のために引く名前も同じ `tx` で
 * 読むので、更新した内容と食い違わない。
 */

import type { Prisma } from '@/generated/prisma/client'
import type { AgentRunAction, AgentRunStatus, TicketStatus } from '@/generated/prisma/enums'
import { extractMentionEmails, normalizeMentionText } from '../board/mention'
import { ticketDisplayId } from '../board/ticket-id'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { commentExcerpt } from './notify'
import { enqueueNotify } from './notify-enqueue'

/**
 * 通知に載せるチケットの識別。表示IDは呼び出し元で組み立てて渡す。
 *
 * `boardId` はチャネル通知の宛先(ボードの設定)を配信直前に引くために持つ。
 * ペイロードへスナップショットするので、チケットが消えても宛先を辿れる。
 */
export type TicketNotifyRef = {
  id: string
  boardId: string
  displayId: string
  title: string
}

/** 通知の判断に使うチケットの状態。`assertTicketAccess()` の戻り(`TicketAccess`)からそのまま作れる */
export type TicketNotifyState = {
  assigneeId: string | null
  status: TicketStatus
}

/** ペイロードのチケット部分。どのイベントも同じ形で持つ */
const ticketPayload = (ticket: TicketNotifyRef) => ({
  ticketId: ticket.id,
  boardId: ticket.boardId,
  displayId: ticket.displayId,
  ticketTitle: ticket.title,
})

/** 操作した人の表示名。文面の「〇〇さんが…」に出す */
const actorName = async (actorId: string, tx: Prisma.TransactionClient): Promise<string> => {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { name: true } })
  return actor?.name ?? ''
}

/**
 * 本文中のメンションを表示名へ解決する。
 *
 * 画面(`mention-node.tsx`)は `@表示名` で描画するので、通知でも同じ見え方に揃える。
 * 引けなかったメールアドレスは画面と同じくそのまま出す。
 */
const resolveMentionNames = async (content: string, tx: Prisma.TransactionClient): Promise<Map<string, string>> => {
  // 正規化・重複除去済み(コードブロック内のメンションも除かれている)
  const emails = extractMentionEmails(content)
  if (emails.length === 0) {
    return new Map()
  }

  const users = await tx.user.findMany({
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
const enqueueMentioned = async (
  param: {
    actorId: string
    ticket: TicketNotifyRef
    userIds: string[]
    /** コメント経由のメンションのみ。抜粋の元にもする */
    comment?: { id: string; content: string }
  },
  tx: Prisma.TransactionClient,
): Promise<void> => {
  const { actorId, ticket, comment } = param
  const targetUserIds = param.userIds.filter((userId) => userId !== actorId)
  if (targetUserIds.length === 0) {
    return
  }

  logger.info({ ticketId: ticket.id, commentId: comment?.id, actorId, targetUserIds }, 'mention notify')

  const excerpt = comment ? commentExcerpt(comment.content, await resolveMentionNames(comment.content, tx)) : ''

  await enqueueNotify(
    {
      event: 'mention',
      actorId,
      targetUserIds,
      payload: {
        ...ticketPayload(ticket),
        fromName: await actorName(actorId, tx),
        ...(comment && { commentId: comment.id }),
        // 記法を落とした結果が空になることもあるので、その場合は無かったことにする
        ...(excerpt && { excerpt }),
      },
    },
    tx,
  )
}

/**
 * 担当者が変わったことの通知。
 *
 * 発火するのは担当が実際に変わって、かつ新しい担当者がいるときだけ
 * (担当を外しただけでは知らせる相手も内容も無い)。
 *
 * DM の宛先は新しい担当者。自分で自分を担当にした場合と、担当がエージェント用ユーザー
 * (DM を読まない)の場合は DM の宛先から外すが、**チャネル通知は宛先が別なので発火させる**。
 */
const enqueueAssigned = async (
  param: {
    actorId: string
    ticket: TicketNotifyRef
    before: string | null
    after: string | null
  },
  tx: Prisma.TransactionClient,
): Promise<void> => {
  const { actorId, ticket, before, after } = param
  if (!after || after === before) {
    return
  }

  const assignee = await tx.user.findUnique({ where: { id: after }, select: { name: true, isAgent: true } })
  if (!assignee) {
    return
  }

  // DM を届ける相手がいない場合も、チャンネルへは「誰が担当になったか」を知らせる
  const targetUserIds = assignee.isAgent || after === actorId ? [] : [after]

  logger.info({ ticketId: ticket.id, actorId, assigneeId: after, targetUserIds }, 'ticket assigned notify')

  await enqueueNotify(
    {
      event: 'ticket_assigned',
      actorId,
      targetUserIds,
      payload: {
        ...ticketPayload(ticket),
        fromName: await actorName(actorId, tx),
        assigneeName: assignee.name,
      },
    },
    tx,
  )
}

/** 完了 / 作成のようにチャネル通知だけのイベント。宛先はボードの設定から引く */
const enqueueTicketChanged = async (
  event: 'ticket_created' | 'ticket_completed',
  param: { actorId: string; ticket: TicketNotifyRef },
  tx: Prisma.TransactionClient,
): Promise<void> => {
  const { actorId, ticket } = param

  logger.info({ ticketId: ticket.id, actorId, event }, 'ticket notify')

  await enqueueNotify(
    {
      event,
      actorId,
      payload: { ...ticketPayload(ticket), fromName: await actorName(actorId, tx) },
    },
    tx,
  )
}

/**
 * チケット作成。
 *
 * 作成時に担当者を付けるのも「担当者に指定された」ことなので、更新時と同じ扱いにする
 * (`before` が無い状態からの変更とみなす)。
 */
export const enqueueTicketCreated = async (
  param: {
    actorId: string
    ticket: TicketNotifyRef
    assigneeId: string | null
    status: TicketStatus
    mentionedUserIds: string[]
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<void> => {
  const { actorId, ticket, assigneeId, status, mentionedUserIds } = param
  await enqueueTicketChanged('ticket_created', { actorId, ticket }, tx)
  await enqueueMentioned({ actorId, ticket, userIds: mentionedUserIds }, tx)
  await enqueueAssigned({ actorId, ticket, before: null, after: assigneeId }, tx)
  // 最初から完了で作ることもできる
  if (status === 'done') {
    await enqueueTicketChanged('ticket_completed', { actorId, ticket }, tx)
  }
}

/**
 * チケット更新。前後の状態から発火すべきイベントを判断する。
 *
 * 新しいトリガーを足すときに触るのはこの関数で、呼び出し元(Server Action / MCP)は変わらない。
 */
export const enqueueTicketUpdated = async (
  param: {
    actorId: string
    ticket: TicketNotifyRef
    before: TicketNotifyState
    after: TicketNotifyState
    /** 本文の編集で増えたメンション。本文を触らない更新では空 */
    addedMentionUserIds: string[]
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<void> => {
  const { actorId, ticket, before, after, addedMentionUserIds } = param
  await enqueueMentioned({ actorId, ticket, userIds: addedMentionUserIds }, tx)
  await enqueueAssigned({ actorId, ticket, before: before.assigneeId, after: after.assigneeId }, tx)
  // 完了レーンへ入った瞬間だけ発火する(完了のまま並べ替えても発火しない)
  if (before.status !== 'done' && after.status === 'done') {
    await enqueueTicketChanged('ticket_completed', { actorId, ticket }, tx)
  }
}

/**
 * ステータスだけの更新(詳細画面のステータス変更・かんばんの DnD)。
 *
 * これらの経路は通知に載せる表示IDや件名を読んでいないので、**発火が決まってから引く**
 * (完了へ動いたときだけの 1 回で、並べ替えのたびに SELECT は増えない)。
 */
export const enqueueTicketMoved = async (
  param: {
    actorId: string
    ticketId: string
    before: TicketStatus
    after: TicketStatus
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<void> => {
  const { actorId, ticketId, before, after } = param
  if (before === 'done' || after !== 'done') {
    return
  }

  const ticket = await loadTicketNotifyRef(ticketId, tx)
  if (!ticket) {
    return
  }
  await enqueueTicketChanged('ticket_completed', { actorId, ticket }, tx)
}

/**
 * PR のマージによる自動完了(GitHub 連携)。操作した人はいないので、システム由来(actorId なし)として投入する。
 * 呼び出し元が完了へ動かしたことを確かめてから呼ぶ。
 */
export const enqueueTicketCompletedByMerge = async (
  param: { ticketId: string; pullRequest: string },
  tx: Prisma.TransactionClient = prisma,
): Promise<void> => {
  const { ticketId, pullRequest } = param
  const ticket = await loadTicketNotifyRef(ticketId, tx)
  if (!ticket) {
    return
  }

  logger.info({ ticketId, pullRequest }, 'ticket completed by merge notify')

  await enqueueNotify(
    {
      event: 'ticket_completed',
      payload: { ...ticketPayload(ticket), fromName: '', pullRequest },
    },
    tx,
  )
}

/** 通知に載せるチケットの識別を引く。削除済みなら通知しないので null */
const loadTicketNotifyRef = async (ticketId: string, tx: Prisma.TransactionClient): Promise<TicketNotifyRef | null> => {
  const ticket = await tx.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, boardId: true, number: true, title: true, board: { select: { key: true } } },
  })
  if (!ticket) {
    return null
  }
  return {
    id: ticket.id,
    boardId: ticket.boardId,
    displayId: ticketDisplayId({ key: ticket.board.key, number: ticket.number }),
    title: ticket.title,
  }
}

/** コメントの投稿・編集。コメント経由のメンションだけを発火する */
export const enqueueTicketCommented = async (
  param: {
    actorId: string
    ticket: TicketNotifyRef
    comment: { id: string; content: string }
    addedMentionUserIds: string[]
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<void> => {
  const { actorId, ticket, comment, addedMentionUserIds } = param
  await enqueueMentioned({ actorId, ticket, userIds: addedMentionUserIds, comment }, tx)
}

/**
 * エージェントの実行終了。
 *
 * 呼び出し元は実行を閉じる 3 経路(`agent-run.ts`)。宛先(依頼者への DM とボードの
 * 通知先チャンネル)はどちらも規則で導けるので、`notify-recipient.ts` が配信直前に解決する。
 */
export type AgentRunNotification = {
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

export const enqueueAgentRunFinished = async (
  param: AgentRunNotification,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> => {
  const { runId, agentName, ticket, action, status, summary, startedAt, finishedAt } = param
  const excerpt = summary ? commentExcerpt(summary) : ''

  logger.info({ runId, ticketId: ticket.id, status }, 'agent run notify')

  await enqueueNotify(
    {
      event: 'agent_run',
      // 実行はエージェントが行うが、DM の宛先は依頼者なので actor は置かない
      payload: {
        ...ticketPayload(ticket),
        runId,
        agentName,
        action,
        status,
        startedAt,
        finishedAt,
        // 記法を落とした結果が空になることもあるので、その場合は無かったことにする
        ...(excerpt && { excerpt }),
      },
    },
    tx,
  )
}
