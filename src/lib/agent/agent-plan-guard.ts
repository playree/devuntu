/**
 * plan の実行中に、プランへの返信を待たずに完了・報告させないための判定(サーバー専用)
 *
 * plan の制約を守るかは CLI・モデル次第なので、サーバー側で止めて、直し方をメッセージで伝える。
 * 人の経路のコメント投稿(mcp-ticket)からも呼ぶので、実行の記録(agent-run)とは分けて軽く保つ。
 */

import { ClientError } from '../error'
import { prisma } from '../prisma'

export const AGENT_PLAN_ONLY = 'AGENT_PLAN_ONLY'

export const errAgentPlanOnly = () =>
  new ClientError(
    AGENT_PLAN_ONLY,
    'This run is a plan: the ticket cannot be completed or reported until a human replies to the plan. ' +
      'Post the plan with add_ticket_comment type=plan (questions as a regular comment) and finish with outcome=planned. ' +
      'Do the work in a later run after the reply',
  )

/** エージェントがこのチケットを plan として処理中なら弾く。plan の実行中に報告書を投稿させないために使う */
export const assertAgentNotPlanning = async (userId: string, ticketId: string): Promise<void> => {
  const count = await prisma.agentRun.count({
    where: { ticketId, status: 'running', action: 'plan', runner: { userId } },
  })
  if (count > 0) {
    throw errAgentPlanOnly()
  }
}
