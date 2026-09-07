/**
 * 宛先の解決(サーバー専用)
 *
 * イベントから「誰へ / どのチャンネルへ」を決める。通知 ON/OFF や連携状況での絞り込みは
 * 次段の `notify-fanout.ts` が行うので、ここでは候補を挙げるところまでを担う。
 *
 * トリガー側でしか決められない宛先(増えたメンション・新しい担当者)は `explicit` として
 * 渡され、規則で導ける宛先(チケットの作成者・ボードの通知先チャンネル)はここで引く。
 * **「誰が知りたいか」の判断がこの 1 箇所に集まる**ので、トリガー側は「何が起きたか」だけを
 * 書けばよい。
 *
 * `satisfies Record<NotifyEvent, ...>` を付けているので、`NotifyEvent` へイベントを足すと
 * 定義漏れがコンパイルエラーになる。
 */

import type { NotifyEvent } from '@/generated/prisma/enums'
import { prisma } from '../prisma'
import { getBoardNotifyChannels } from './notify-board-setting'
import type { NotifyPayload } from './notify-payload'

export type NotifyTargets = {
  /** DM の宛先(ユーザーID) */
  userIds: string[]
  /** チャネル通知の宛先(Slack チャンネルID) */
  slackChannelIds: string[]
}

/** アウトボックスが持つ、トリガー側でしか決められない宛先 */
export type ExplicitTargets = {
  userIds: string[]
}

/**
 * チケットの作成者。エージェントの実行結果を知りたいのは処理を依頼した本人。
 *
 * エージェント用ユーザーは DM を読まないので除く。チケットが削除済みなら辿れないので空になる
 * (配信は投入から遅れて走るため起こりうる)。
 */
const ticketRequesterIds = async (ticketId: string): Promise<string[]> => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { createdBy: { select: { id: true, isAgent: true } } },
  })
  const requester = ticket?.createdBy
  return requester && !requester.isAgent ? [requester.id] : []
}

/**
 * ボードに設定された投稿先チャンネル。
 *
 * 行が無いイベントは通知しないので空になる。`boardId` はペイロードのスナップショットから取る
 * ので、チケットが削除済みでも宛先を辿れる。
 */
const boardChannels = async (boardId: string | undefined, event: NotifyEvent): Promise<string[]> =>
  boardId ? getBoardNotifyChannels(boardId, event) : []

type Resolver<E extends NotifyEvent> = (
  payload: NotifyPayload<E>,
  explicit: ExplicitTargets,
) => Promise<NotifyTargets> | NotifyTargets

const RESOLVERS = {
  /** メンションはトリガー側でしか分からない(本文を解いて増えた分だけ)。チャネル通知は持たない */
  mention: (_payload, explicit) => ({ userIds: explicit.userIds, slackChannelIds: [] }),

  /** エージェント実行結果は依頼者へ DM し、ボードに設定があればチャンネルへも投稿する */
  agent_run: async (payload) => ({
    userIds: await ticketRequesterIds(payload.ticketId),
    slackChannelIds: await boardChannels(payload.boardId, 'agent_run'),
  }),

  /** 担当変更の DM は新しい担当者へ(トリガー側で actor 自身とエージェントを除いてある) */
  ticket_assigned: async (payload, explicit) => ({
    userIds: explicit.userIds,
    slackChannelIds: await boardChannels(payload.boardId, 'ticket_assigned'),
  }),

  /** 作成 / 完了はチャネル通知のみ。個人宛の設定では表せない */
  ticket_created: async (payload) => ({
    userIds: [],
    slackChannelIds: await boardChannels(payload.boardId, 'ticket_created'),
  }),

  ticket_completed: async (payload) => ({
    userIds: [],
    slackChannelIds: await boardChannels(payload.boardId, 'ticket_completed'),
  }),
} as const satisfies { [E in NotifyEvent]: Resolver<E> }

export const resolveNotifyTargets = async <E extends NotifyEvent>(
  event: E,
  payload: NotifyPayload<E>,
  explicit: ExplicitTargets,
): Promise<NotifyTargets> => (RESOLVERS[event] as Resolver<E>)(payload, explicit)
