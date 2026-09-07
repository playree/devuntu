/**
 * エージェントの実行結果通知(ボードのSlackチャンネル宛)
 *
 * 実行が終了した時点で、対象チケットが所属するボードに設定された Slack チャンネルへ結果を投稿する。
 * 呼び出し元(`agent-runner.ts` の実行を閉じる 3 経路)はこの関数だけを見ている。
 *
 * ここで行うのはキューへの投入までで、送信は配信ワーカー(`notify-dispatch.ts`)が行う。
 * メンション通知(`notify-mention.ts`)と違い宛先は個人ではなくチャンネルなので、
 * ユーザーごとの通知設定(`UserNotifySetting`)とは独立している。
 */

import type { AgentRunAction, AgentRunStatus } from '@/generated/prisma/enums'
import { commentExcerpt } from './notify'
import { enqueueNotify } from './notify-enqueue'

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

export const notifyAgentRun = async (param: AgentRunNotification): Promise<void> => {
  const { slackChannelId, runId, agentName, ticketId, displayId, ticketTitle } = param
  if (!slackChannelId) {
    return
  }

  const { action, status, summary, startedAt, finishedAt } = param
  const excerpt = summary ? commentExcerpt(summary) : ''

  await enqueueNotify({
    event: 'agent_run',
    targetSlackChannelIds: [slackChannelId],
    payload: {
      ticketId,
      displayId,
      ticketTitle,
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
