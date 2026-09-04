/**
 * 自動運用(Devuntu Agent)の設定・実行履歴の入出力(サーバー専用)
 *
 * 管理者のエージェント詳細画面と、承認者のエージェント承認画面の両方から同じ内容を扱うため、
 * DB 操作だけをここへ集約する。「誰が触ってよいか」は呼び出し元の Server Action の責務なので、
 * このファイルには認可を持ち込まない(`agent-approver.ts` と同じ切り分け)。
 *
 * ランナー本体や MCP が使う稼働判定・実行記録は `agent-runner.ts` 側にある。
 */

import type { AgentRunAction, AgentRunStatus } from '@/generated/prisma/enums'
import { isValidTimezone } from '../day'
import { errValidation } from '../error'
import { logger } from '../logger'
import { prisma } from '../prisma'
import type { SaveAgentRunner } from '../schema/schema'
import { AGENT_RUN_HISTORY_LIMIT } from './agent'
import { countAgentRunsSince, dailyRunWindow } from './agent-runner'

/** 画面に出す自動運用の設定。ランナーの自己申告(ホスト名・版)と消化状況を含む */
export type AgentRunnerConfig = {
  id: string
  enabled: boolean
  activeFromMin: number | null
  activeToMin: number | null
  timezone: string | null
  pollIntervalSec: number
  rule: string | null
  dailyRunLimit: number
  dailyResetMin: number
  lastPolledAt: Date | null
  hostname: string | null
  version: string | null
  todayRuns: number
}

/** 設定取得。行が無ければ null(= 自動運用を使わない) */
export const findAgentRunnerConfig = async (userId: string): Promise<AgentRunnerConfig | null> => {
  const runner = await prisma.agentRunner.findUnique({
    where: { userId },
    select: {
      id: true,
      enabled: true,
      activeFromMin: true,
      activeToMin: true,
      timezone: true,
      pollIntervalSec: true,
      rule: true,
      dailyRunLimit: true,
      dailyResetMin: true,
      lastPolledAt: true,
      hostname: true,
      version: true,
    },
  })
  if (!runner) {
    return null
  }

  // 上限の判定と同じ期間で数える。上限が無制限でも消化状況としては見せる
  const { since } = dailyRunWindow(runner)
  return { ...runner, todayRuns: await countAgentRunsSince(prisma, runner.id, since) }
}

/** 設定保存(無ければ作成)。ランナーの自己申告(ホスト名・版)はここでは触らない */
export const saveAgentRunnerConfig = async ({ userId, timezone, ...rest }: SaveAgentRunner): Promise<void> => {
  // IANA 名として解決できるかは zod では見られない(実行環境の ICU に依存する)
  if (timezone && !isValidTimezone(timezone)) {
    throw errValidation('timezone')
  }

  const data = { ...rest, timezone }
  await prisma.agentRunner.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
    select: { id: true },
  })

  logger.info({ userId, enabled: data.enabled }, 'agent runner saved')
}

/**
 * カスタム指示(ルール)単体の保存。
 * 設定行が無い状態(自動運用が未設定)でもルールだけ先に保存できるよう upsert する。
 */
export const saveAgentRunnerRuleValue = async (userId: string, rule: string | null | undefined): Promise<void> => {
  // 空欄は「指示なし」。空文字のまま保存すると MCP 側で「空の指示」として渡ってしまう
  const data = { rule: rule || null }
  await prisma.agentRunner.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
    select: { id: true },
  })

  logger.info({ userId }, 'agent runner rule saved')
}

/** 実行履歴の1件 */
export type AgentRunSummary = {
  id: string
  ticketId: string | null
  ticketRef: string | null
  action: AgentRunAction
  status: AgentRunStatus
  summary: string | null
  startedAt: Date
  finishedAt: Date | null
}

/** 実行履歴。件数が増え続けるので新しい順に上限まで返す */
export const listAgentRuns = async (userId: string): Promise<AgentRunSummary[]> => {
  const runner = await prisma.agentRunner.findUnique({ where: { userId }, select: { id: true } })
  if (!runner) {
    return []
  }

  return await prisma.agentRun.findMany({
    where: { runnerId: runner.id },
    select: {
      id: true,
      ticketId: true,
      ticketRef: true,
      action: true,
      status: true,
      summary: true,
      startedAt: true,
      finishedAt: true,
    },
    orderBy: { startedAt: 'desc' },
    take: AGENT_RUN_HISTORY_LIMIT,
  })
}
