/**
 * エージェントの利用量(トークン数・コスト)の記録と集計(サーバー専用)
 *
 * 計測値は CLI の出力からランナーが取得し、実行の終了報告(`PATCH /api/agent/runs/:id`)に載せて送る。
 * 実行1件ぶんは `AgentRun` に、月の合計は `AgentUsage` に積み上げる。
 * 予算上限の判定は `agent-activity.ts` にある。
 */

import { Prisma } from '@/generated/prisma/client'
import type { BoardKind } from '@/generated/prisma/enums'
import { nowDate } from '../day'
import { logger } from '../logger'
import { type Db, prisma } from '../prisma'
import { monthlyUsageWindow } from './agent-activity'
import type { AgentRunnerRow } from './agent-runner'

/** ランナーが送る計測値。取れなかった項目は持たない */
export type AgentRunMetrics = {
  model?: string | null
  inputTokens?: number | null
  cachedInputTokens?: number | null
  outputTokens?: number | null
  costUsd?: number | null
  exitCode?: number | null
}

/**
 * ランナーの行をロックする。1日の上限 / 予算の判定と、月の集計行の作成を直列にするために使う
 * (集計行は boardId が null になり得るので一意制約で重複を防げない)。
 */
export const lockAgentRunner = async (tx: Prisma.TransactionClient, runnerId: string): Promise<void> => {
  await tx.$queryRaw`SELECT "id" FROM "agent_runner" WHERE "id" = ${runnerId} FOR UPDATE`
}

const hasUsage = (metrics: AgentRunMetrics): boolean =>
  [metrics.inputTokens, metrics.cachedInputTokens, metrics.outputTokens, metrics.costUsd].some(
    (value) => value !== null && value !== undefined,
  )

/**
 * 実行1件ぶんの計測値を記録し、月の集計へ加算する。
 *
 * 実行は `finish_agent_task` で先に閉じていることが多いので、状態によらず計測値だけは書き込む。
 * 同じ実行へ2度届いても `measuredAt` を印に1度しか加算しない。集計する月は実行の開始時刻で決める。
 */
export const recordAgentRunMetrics = async (
  tx: Prisma.TransactionClient,
  runner: Pick<AgentRunnerRow, 'id' | 'timezone' | 'dailyResetMin'>,
  run: { id: string; startedAt: Date; boardId: string | null },
  metrics: AgentRunMetrics,
  now: Date = nowDate(),
): Promise<boolean> => {
  await lockAgentRunner(tx, runner.id)

  const { count } = await tx.agentRun.updateMany({
    where: { id: run.id, measuredAt: null },
    data: { ...metrics, measuredAt: now },
  })
  if (count === 0 || !hasUsage(metrics)) {
    return count > 0
  }

  const { month } = monthlyUsageWindow(runner, run.startedAt)
  const increment = {
    runs: { increment: 1 },
    inputTokens: { increment: BigInt(metrics.inputTokens ?? 0) },
    cachedInputTokens: { increment: BigInt(metrics.cachedInputTokens ?? 0) },
    outputTokens: { increment: BigInt(metrics.outputTokens ?? 0) },
    costUsd: { increment: metrics.costUsd ?? 0 },
  }
  const current = await tx.agentUsage.findFirst({
    where: { runnerId: runner.id, month, boardId: run.boardId },
    select: { id: true },
  })
  if (current) {
    await tx.agentUsage.update({ where: { id: current.id }, data: increment, select: { id: true } })
  } else {
    await tx.agentUsage.create({
      data: {
        runnerId: runner.id,
        month,
        boardId: run.boardId,
        runs: 1,
        inputTokens: BigInt(metrics.inputTokens ?? 0),
        cachedInputTokens: BigInt(metrics.cachedInputTokens ?? 0),
        outputTokens: BigInt(metrics.outputTokens ?? 0),
        costUsd: metrics.costUsd ?? 0,
      },
      select: { id: true },
    })
  }

  logger.info({ runnerId: runner.id, runId: run.id, month }, 'agent usage recorded')
  return true
}

/** 画面に出す利用量。トークンの合計は BigInt で持つが、表示には Number で足りる */
export type AgentUsageTotal = {
  runs: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  costUsd: number
}

export type AgentBoardUsage = AgentUsageTotal & {
  /** ボードが削除済みの行は null */
  board: { id: string; name: string; kind: BoardKind } | null
}

export type AgentMonthlyUsage = {
  month: string
  resetAt: Date
  total: AgentUsageTotal
  /** コストの大きい順。削除済みのボードは1行にまとめる */
  boards: AgentBoardUsage[]
}

const emptyTotal = (): AgentUsageTotal => ({
  runs: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
})

const addUsage = (
  target: AgentUsageTotal,
  row: { runs: number; inputTokens: bigint; cachedInputTokens: bigint; outputTokens: bigint; costUsd: Prisma.Decimal },
) => {
  target.runs += row.runs
  target.inputTokens += Number(row.inputTokens)
  target.cachedInputTokens += Number(row.cachedInputTokens)
  target.outputTokens += Number(row.outputTokens)
  target.costUsd += row.costUsd.toNumber()
}

/** 今月の利用量(合計とボード別の内訳)。ランナーが無ければ null */
export const findAgentMonthlyUsage = async (
  userId: string,
  now: Date = nowDate(),
  db: Db = prisma,
): Promise<AgentMonthlyUsage | null> => {
  const runner = await db.agentRunner.findUnique({
    where: { userId },
    select: { id: true, timezone: true, dailyResetMin: true },
  })
  if (!runner) {
    return null
  }

  const { month, resetAt } = monthlyUsageWindow(runner, now)
  const rows = await db.agentUsage.findMany({
    where: { runnerId: runner.id, month },
    select: {
      runs: true,
      inputTokens: true,
      cachedInputTokens: true,
      outputTokens: true,
      costUsd: true,
      board: { select: { id: true, name: true, kind: true } },
    },
  })

  const total = emptyTotal()
  const byBoard = new Map<string, AgentBoardUsage>()
  for (const { board, ...row } of rows) {
    addUsage(total, row)
    const key = board?.id ?? ''
    const entry = byBoard.get(key) ?? { ...emptyTotal(), board }
    addUsage(entry, row)
    byBoard.set(key, entry)
  }

  return { month, resetAt, total, boards: [...byBoard.values()].sort((a, b) => b.costUsd - a.costUsd) }
}
