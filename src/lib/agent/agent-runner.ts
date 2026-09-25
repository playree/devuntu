/**
 * AIエージェントの自動運用(Devuntu Agent)のランナー設定の取得(サーバー専用)
 *
 * 利用者のマシンで動くランナー(`/api/agent/*`)と、Claude が使う MCP ツール(`mcp-agent.ts`)の
 * 両方から呼ぶ。稼働判定は `agent-activity.ts`、処理対象のチケットは `agent-task.ts`、
 * 実行の記録は `agent-run.ts` にあり、`Ticket.agentState` を遷移させるのはこれらだけ。
 */

import { Prisma } from '@/generated/prisma/client'
import { prisma } from '../prisma'

/** `AgentRunner` を引くときの共通 select。呼び出し側で形がずれないようにここへ置く */
export const agentRunnerSelect = {
  id: true,
  userId: true,
  enabled: true,
  activeFromMin: true,
  activeToMin: true,
  timezone: true,
  pollIntervalSec: true,
  rule: true,
  dailyRunLimit: true,
  dailyResetMin: true,
  /** エージェントユーザー。実行結果の通知に表示名を載せる */
  user: { select: { name: true } },
} as const satisfies Prisma.AgentRunnerSelect

export type AgentRunnerRow = Prisma.AgentRunnerGetPayload<{ select: typeof agentRunnerSelect }>

export const findAgentRunner = async (userId: string): Promise<AgentRunnerRow | null> =>
  prisma.agentRunner.findUnique({ where: { userId }, select: agentRunnerSelect })
