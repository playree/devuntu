/**
 * エージェントの実行結果通知(ボードのSlackチャンネル宛)
 *
 * 実行が終了した時点で、対象チケットが所属するボードに設定された Slack チャンネルへ結果を投稿する。
 * 呼び出し元(`agent-runner.ts` の実行を閉じる 3 経路)はこの関数だけを見ているので、
 * 通知手段を追加・変更する場合もこのファイルの中だけで完結させる。
 *
 * メンション通知(`notify-mention.ts`)と違い宛先は個人ではなくチャンネルなので、
 * ユーザーごとの通知設定(`UserNotifySetting`)とは独立している。
 */

import type { AgentRunAction, AgentRunStatus } from '@/generated/prisma/enums'
import { t } from '@/locale/server'
import { after } from 'next/server'
import { AGENT_RUN_ACTION_LOCALE, AGENT_RUN_STATUS_LOCALE, agentRunDuration } from '../agent/agent'
import { logger } from '../logger'
import { makeUrl } from '../server-utils'
import { buildTicketMessage } from '../slack/slack'
import { getSlackSettings, hasSlackCredentials } from '../slack/slack-account'
import { postSlackMessage } from '../slack/slack-server'
import { commentExcerpt } from './notify'

export type AgentRunNotification = {
  /** 通知先チャンネル。null なら通知しない(呼び出し側で分岐させず、ここで吸収する) */
  slackChannelId: string | null
  runId: string
  /** 実行したエージェントの表示名 */
  agentName: string
  /** 対象チケット。削除済みの実行は通知しないので必須 */
  ticketId: string
  /** 表示ID(`KEY-番号`) */
  displayId: string
  ticketTitle: string
  action: AgentRunAction
  /** 終了時のみ通知するので、実行中は受け取らない */
  status: Exclude<AgentRunStatus, 'running'>
  /** エージェントが報告した結果の要約 */
  summary: string | null
  startedAt: Date
  finishedAt: Date
}

/**
 * 実行結果をボードのチャンネルへ投稿する。
 *
 * 宛先がユーザーではないためロケールを解決する相手がいない。文面は `t(null, ...)` で
 * 既定ロケール(`DEFAULT_LOCALE`)に固定する。
 *
 * リンク先は短縮URL(`/t/<表示ID>`)ではなくチケット詳細(`/tickets/<id>`)にする。
 * 短縮URLはボードメンバーの可視スコープで解決するため、実行履歴の一覧
 * (`agent-run-history.tsx`)と同じ判断に揃えている。
 */
export const notifyAgentRun = async (param: AgentRunNotification): Promise<void> => {
  const { slackChannelId, runId, ticketId, displayId, status } = param
  if (!slackChannelId || !hasSlackCredentials()) {
    return
  }

  // 通知は実行記録の付随処理。外部サービスとの往復でレスポンスを遅らせず、
  // 失敗も実行記録へ波及させない
  after(async () => {
    try {
      // 管理者が Slack 連携ごと止めたら、チャンネル通知も止まるようにする
      const { enabled } = await getSlackSettings()
      if (!enabled) {
        return
      }

      const { agentName, ticketTitle, action, summary, startedAt, finishedAt } = param
      const excerpt = summary ? commentExcerpt(summary) : ''

      const outcome = await postSlackMessage(
        slackChannelId,
        buildTicketMessage({
          subject: `[${displayId}] ${ticketTitle}`,
          url: makeUrl(`/tickets/${ticketId}`).toString(),
          body: t(null, 'notify_msg_agent_run_finished', {
            agent: agentName,
            action: t(null, AGENT_RUN_ACTION_LOCALE[action]),
            result: t(null, AGENT_RUN_STATUS_LOCALE[status]),
            duration: agentRunDuration(startedAt, finishedAt),
          }),
          // 記法を落とした結果が空になることもあるので、その場合は無かったことにする
          ...(excerpt && { excerpt }),
          openLabel: t(null, 'slack_msg_open_ticket'),
        }),
      )

      if (outcome === 'unlinked') {
        // 保存時に一覧で実在を確かめているので、通常は Bot がチャンネルから外された場合に起きる
        logger.warn({ runId, slackChannelId }, 'slack agent run notify skipped by channel access')
      }
    } catch (error) {
      logger.error({ error, runId, ticketId, displayId }, 'agent run notify failed')
    }
  })
}
