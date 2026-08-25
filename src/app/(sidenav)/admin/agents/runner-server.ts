'use server'

import { safeAuthAction } from '@/lib/action-server'
import { AGENT_RUN_HISTORY_LIMIT } from '@/lib/agent'
import { isValidTimezone } from '@/lib/day'
import { errValidation } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scSaveAgentRunner, scUUID } from '@/lib/schema'
import { assertAgent } from './agent-util'

/**
 * 自動運用(Devuntu Agent)の設定と実行履歴。
 *
 * 設定行が無い状態は「自動運用を使わない」を表す。保存すると行が作られ、以降は
 * `enabled` の切り替えで止める(行を消す操作は用意しない。履歴が一緒に消えてしまうため)。
 */

/** 設定取得。行が無ければ null(= 未設定) */
export const getAgentRunner = safeAuthAction
  .metadata({ actionName: 'getAgentRunner', role: 'admin' })
  .inputSchema(scUUID)
  .action(async ({ parsedInput: { id } }) => {
    await assertAgent(id)

    return await prisma.agentRunner.findUnique({
      where: { userId: id },
      select: {
        enabled: true,
        activeFromMin: true,
        activeToMin: true,
        timezone: true,
        pollIntervalSec: true,
        defaultMode: true,
        preTask: true,
        postTask: true,
        lastPolledAt: true,
        hostname: true,
        version: true,
      },
    })
  })
export type GetAgentRunnerReturnType = Awaited<ReturnType<typeof getAgentRunner>>['data']

/** 設定保存(無ければ作成)。ランナーの自己申告(ホスト名・版)はここでは触らない */
export const saveAgentRunner = safeAuthAction
  .metadata({ actionName: 'saveAgentRunner', role: 'admin' })
  .inputSchema(scSaveAgentRunner)
  .action(async ({ parsedInput: { userId, timezone, ...rest } }) => {
    await assertAgent(userId)
    // IANA 名として解決できるかは zod では見られない(実行環境の ICU に依存する)
    if (timezone && !isValidTimezone(timezone)) {
      throw errValidation('timezone')
    }

    // 空欄は「指示なし」。空文字のまま保存すると MCP 側で「空の指示」として渡ってしまう
    const data = { ...rest, timezone, preTask: rest.preTask || null, postTask: rest.postTask || null }
    await prisma.agentRunner.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
      select: { id: true },
    })

    logger.info({ userId, enabled: data.enabled }, 'agent runner saved')
    return { userId }
  })

/** 実行履歴。件数が増え続けるので新しい順に上限まで返す */
export const getAgentRuns = safeAuthAction
  .metadata({ actionName: 'getAgentRuns', role: 'admin' })
  .inputSchema(scUUID)
  .action(async ({ parsedInput: { id } }) => {
    await assertAgent(id)

    const runner = await prisma.agentRunner.findUnique({ where: { userId: id }, select: { id: true } })
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
  })
export type GetAgentRunsReturnType = Awaited<ReturnType<typeof getAgentRuns>>['data']
