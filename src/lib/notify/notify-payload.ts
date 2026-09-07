/**
 * 通知ペイロードの定義(サーバー専用)
 *
 * アウトボックスの `payload` に入れる値をイベントごとに定義する。
 * 配信はトリガーの発生から遅れて走り、その間にチケットやコメントが消えることもあるため、
 * 文面に出すものは投入時にスナップショットしてここへ入れる(配信時に引き直さない)。
 *
 * `satisfies Record<NotifyEvent, ...>` を付けているので、`NotifyEvent` へイベントを足すと
 * 定義漏れがコンパイルエラーになる。
 */

import { AgentRunAction, type NotifyEvent } from '@/generated/prisma/enums'
import { z } from 'zod'
import { errValidation } from '../error'

/** どのイベントも持つチケットの参照。件名とリンクの組み立てに使う */
const scTicketRef = z.object({
  ticketId: z.string().min(1),
  /** 利用者向けの表示ID(`KEY-番号`) */
  displayId: z.string().min(1),
  ticketTitle: z.string(),
})

/** 抜粋は `commentExcerpt()` を通した1行。空になったものは持たせない */
const scExcerpt = z.string().min(1).optional()

const scMention = scTicketRef.extend({
  /** コメント経由のメンションのみ。チケット本文のメンションでは省略する */
  commentId: z.string().min(1).optional(),
  excerpt: scExcerpt,
  /** メンションした本人の表示名 */
  fromName: z.string(),
})

const scAgentRun = scTicketRef.extend({
  runId: z.string().min(1),
  /** 実行したエージェントの表示名 */
  agentName: z.string(),
  action: z.enum(AgentRunAction),
  /** 終了時のみ通知するので running は受け取らない */
  status: z.enum(['succeeded', 'failed', 'skipped']),
  excerpt: scExcerpt,
  /** Json を経由すると文字列になるので、読み出し側で Date へ戻す */
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date(),
})

const scTicketAssigned = scTicketRef.extend({
  /** 担当者を変えた本人の表示名 */
  fromName: z.string(),
})

/** イベントごとのペイロード定義。イベントを足すとここが型エラーになる */
export const NOTIFY_PAYLOAD_SCHEMA = {
  mention: scMention,
  agent_run: scAgentRun,
  ticket_assigned: scTicketAssigned,
} as const satisfies Record<NotifyEvent, z.ZodType>

export type NotifyPayloadMap = { [E in NotifyEvent]: z.infer<(typeof NOTIFY_PAYLOAD_SCHEMA)[E]> }
export type NotifyPayload<E extends NotifyEvent = NotifyEvent> = NotifyPayloadMap[E]

/**
 * アウトボックスから読み出したペイロードを検証する。
 *
 * 形が壊れた行は文面を組み立てられないので、配信側でその行だけを諦めさせる。
 */
export const parseNotifyPayload = <E extends NotifyEvent>(event: E, payload: unknown): NotifyPayload<E> => {
  const parsed = NOTIFY_PAYLOAD_SCHEMA[event].safeParse(payload)
  if (!parsed.success) {
    throw errValidation(`invalid notify payload: ${event}`)
  }
  return parsed.data as NotifyPayload<E>
}
