/**
 * 通知の文面(サーバー専用)
 *
 * ペイロードと宛先のロケールから、チャネルに依らない見出し・本文・リンクを組み立てる。
 * チャネル別の配信(`notify-email.ts` / `notify-slack.ts`)はここから先だけを見るので、
 * イベントを足しても配信側は変わらない。
 *
 * `satisfies Record<NotifyEvent, ...>` を付けているので、`NotifyEvent` へイベントを足すと
 * 定義漏れがコンパイルエラーになる。
 */

import type { NotifyEvent } from '@/generated/prisma/enums'
import { t } from '@/locale/server'
import { AGENT_RUN_ACTION_LOCALE, AGENT_RUN_STATUS_LOCALE, agentRunDuration } from '../agent/agent'
import { commentAnchorId, ticketShortPath } from '../board/task'
import { makeUrl } from '../server-utils'
import type { NotifyPayload } from './notify-payload'

export type NotifyContent = {
  /** 見出し。メールの件名にもそのまま使えるよう表示IDを先頭に置く */
  subject: string
  /** 誰が何をしたかの一文。宛先のロケールで解決済み */
  body: string
  /** 遷移先の絶対URL */
  url: string
  /** 引用として出す抜粋。無い場合は持たせない */
  excerpt?: string
}

/**
 * 見出しは表示IDを先頭に置く。受け取った側が本文を開かなくてもどのチケットの話かが分かる。
 * 利用者の入力(チケット名)を含むため、ログには出さない。
 */
const subjectOf = ({ displayId, ticketTitle }: { displayId: string; ticketTitle: string }) =>
  `[${displayId}] ${ticketTitle}`

type ContentBuilder<E extends NotifyEvent> = (payload: NotifyPayload<E>, locale: string | null) => NotifyContent

const BUILDERS = {
  /**
   * メンションのリンク先は短縮URL(`/t/<表示ID>`)。
   * コメント宛のときだけ、該当コメントの位置まで開けるようフラグメントを付ける。
   */
  mention: (payload, locale) => {
    const { displayId, commentId, excerpt, fromName } = payload
    const path = commentId ? `${ticketShortPath(displayId)}#${commentAnchorId(commentId)}` : ticketShortPath(displayId)
    return {
      subject: subjectOf(payload),
      body: t(locale, commentId ? 'notify_msg_mentioned_comment' : 'notify_msg_mentioned', { from: fromName }),
      url: makeUrl(path).toString(),
      ...(excerpt && { excerpt }),
    }
  },

  /**
   * エージェント実行結果のリンク先は**短縮URLではなくチケット詳細**(`/tickets/<id>`)。
   * 短縮URLはボードメンバーの可視スコープで解決するため、実行履歴の一覧
   * (`agent-run-history.tsx`)と同じ判断に揃えている。
   */
  agent_run: (payload, locale) => {
    const { ticketId, agentName, action, status, excerpt, startedAt, finishedAt } = payload
    return {
      subject: subjectOf(payload),
      body: t(locale, 'notify_msg_agent_run_finished', {
        agent: agentName,
        action: t(locale, AGENT_RUN_ACTION_LOCALE[action]),
        result: t(locale, AGENT_RUN_STATUS_LOCALE[status]),
        duration: agentRunDuration(startedAt, finishedAt),
      }),
      url: makeUrl(`/tickets/${ticketId}`).toString(),
      ...(excerpt && { excerpt }),
    }
  },
} as const satisfies { [E in NotifyEvent]: ContentBuilder<E> }

/**
 * 通知の文面を組み立てる。
 *
 * 宛先がチャンネルの通知はロケールを解決する相手がいないので、呼び出し側が `locale` に
 * null を渡して既定ロケール(`DEFAULT_LOCALE`)へ固定する。
 */
export const buildNotifyContent = <E extends NotifyEvent>(
  event: E,
  payload: NotifyPayload<E>,
  locale: string | null,
): NotifyContent => (BUILDERS[event] as ContentBuilder<E>)(payload, locale)
