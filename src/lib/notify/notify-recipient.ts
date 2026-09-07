/**
 * 宛先の解決(サーバー専用)
 *
 * イベントから「誰へ / どのチャンネルへ」を決める。通知 ON/OFF や連携状況での絞り込みは
 * 次段の `notify-fanout.ts` が行うので、ここでは候補を挙げるところまでを担う。
 *
 * `satisfies Record<NotifyEvent, ...>` を付けているので、`NotifyEvent` へイベントを足すと
 * 定義漏れがコンパイルエラーになる。
 */

import type { NotifyEvent } from '@/generated/prisma/enums'
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
  slackChannelIds: string[]
}

type Resolver<E extends NotifyEvent> = (
  payload: NotifyPayload<E>,
  explicit: ExplicitTargets,
) => Promise<NotifyTargets> | NotifyTargets

/**
 * イベントごとの宛先の決め方。ここだけがイベントを網羅する。
 *
 * 規則で導ける宛先(ボードのチャンネル、チケットの作成者など)を足す場合は、
 * この関数の中で引く。トリガー側は「何が起きたか」だけを書けばよい。
 */
const RESOLVERS = {
  /** メンションはトリガー側でしか分からない(本文を解いて増えた分だけ) */
  mention: (_payload, explicit) => ({ userIds: explicit.userIds, slackChannelIds: [] }),

  /** エージェント実行結果は現状チャンネル通知のみ。DM は今後のトリガー拡張で足す */
  agent_run: (_payload, explicit) => ({ userIds: [], slackChannelIds: explicit.slackChannelIds }),
} as const satisfies { [E in NotifyEvent]: Resolver<E> }

export const resolveNotifyTargets = async <E extends NotifyEvent>(
  event: E,
  payload: NotifyPayload<E>,
  explicit: ExplicitTargets,
): Promise<NotifyTargets> => (RESOLVERS[event] as Resolver<E>)(payload, explicit)
