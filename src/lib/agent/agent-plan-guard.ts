/**
 * プランへの返信を待たずに、エージェントが完了・報告するのを止めるための判定(サーバー専用)
 *
 * plan の制約を守るかは CLI・モデル次第なので、サーバー側で止めて、直し方をメッセージで伝える。
 * 人の経路のコメント投稿(mcp-ticket)からも呼ぶので、実行の記録(agent-run)とは分けて軽く保つ。
 */

import type { Prisma } from '@/generated/prisma/client'
import type { AgentRunAction, AgentRunStatus, AgentTaskState } from '@/generated/prisma/enums'
import { ClientError } from '../error'
import { prisma } from '../prisma'

export const AGENT_PLAN_ONLY = 'AGENT_PLAN_ONLY'

export const errAgentPlanOnly = () =>
  new ClientError(
    AGENT_PLAN_ONLY,
    'This ticket is waiting for a human reply to the plan: it cannot be completed or reported yet. ' +
      'Post the plan with add_ticket_comment type=plan (questions as a regular comment) and finish with outcome=planned. ' +
      'Do the work in a later run after the reply',
  )

/**
 * このエージェントの直近の実行とチケットの処理状態から、プランへの返信を待つべきかを決める。
 *
 * plan の実行中に加え、planned で閉じて返信待ちのまま次の実行が始まっていない間も待つべきとする
 * (planned で閉じた直後に同じ CLI が報告・完了へ進むのを止めるため)。
 * 返信を受けた次の実行(revise)が始まれば、処理状態は running になり対象から外れる。
 * このエージェントが処理したことの無いチケットは対象外。
 */
export const awaitsPlanReply = (
  latest: { action: AgentRunAction; status: AgentRunStatus } | null,
  agentState: AgentTaskState | null | undefined,
): boolean => {
  if (!latest) {
    return false
  }
  return latest.status === 'running' ? latest.action === 'plan' : agentState === 'planned'
}

/** `awaitsPlanReply` の判定材料を引いて判定する */
export const findAwaitsPlanReply = async (
  db: Prisma.TransactionClient,
  runnerId: string,
  ticketId: string,
): Promise<boolean> => {
  const [latest, ticket] = await Promise.all([
    db.agentRun.findFirst({
      where: { runnerId, ticketId },
      orderBy: { startedAt: 'desc' },
      select: { action: true, status: true },
    }),
    db.ticket.findUnique({ where: { id: ticketId }, select: { agentState: true } }),
  ])
  return awaitsPlanReply(latest, ticket?.agentState)
}

/** プランへの返信を待つべきチケットなら、エージェントの報告書の投稿を弾く */
export const assertAgentReportAllowed = async (userId: string, ticketId: string): Promise<void> => {
  const runner = await prisma.agentRunner.findUnique({ where: { userId }, select: { id: true } })
  if (runner && (await findAwaitsPlanReply(prisma, runner.id, ticketId))) {
    throw errAgentPlanOnly()
  }
}
