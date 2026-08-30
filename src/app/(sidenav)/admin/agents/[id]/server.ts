'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { AGENT_RUN_HISTORY_LIMIT, agentTokenExpiresAt } from '@/lib/agent/agent'
import {
  addAgentApprover,
  getAgentApprovers as findAgentApprovers,
  listAgentApproverUsers,
  removeAgentApprover,
  syncAgentApproverGroups,
} from '@/lib/agent/agent-approver'
import { countAgentRunsSince, dailyRunWindow } from '@/lib/agent/agent-runner'
import { generateAgentToken, hashAgentToken } from '@/lib/agent/agent-token'
import { auth } from '@/lib/auth/auth'
import { isValidTimezone, nowDate } from '@/lib/day'
import { errInvalidOperation, errValidation } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import {
  scAgentApproverUser,
  scIssueAgentToken,
  scSaveAgentRunner,
  scSetAgentApproverGroups,
  scUpdateAgent,
  scUUID,
} from '@/lib/schema/schema'
import { headers } from 'next/headers'
import { assertAgent } from '../agent-util'

/** エージェント単票取得。詳細ページの Profile セクションで使う */
export const getAgent = safeAuthAction
  .metadata({ actionName: 'getAgent', role: 'admin' })
  .inputSchema(scUUID)
  .action(async ({ parsedInput: { id } }) => {
    await assertAgent(id)

    const agent = await prisma.user.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        userGroups: { select: { group: { select: { id: true, name: true } } } },
      },
    })
    const { userGroups, ...rest } = agent
    return { ...rest, groups: userGroups.map((ug) => ug.group) }
  })
export type GetAgentReturnType = Awaited<ReturnType<typeof getAgent>>['data']

/**
 * エージェント更新。
 * 識別子(= メールアドレス)は保存済み本文のメンションが解決できなくなるため変更させない。
 */
export const updateAgent = safeAuthAction
  .metadata({ actionName: 'updateAgent', role: 'admin' })
  .inputSchema(scUpdateAgent)
  .action(async ({ parsedInput: { id, name, groups } }) => {
    const groupIds = [...new Set(groups)]

    await assertAgent(id)
    await assertGroupsExist(groupIds)

    await auth.api.adminUpdateUser({
      headers: await headers(),
      body: { userId: id, data: { name } },
    })
    await syncGroups(id, groupIds)

    logger.info({ id, groups: groupIds }, 'agent updated')
    return { id }
  })

/** エージェント削除。AgentToken は onDelete: Cascade で一緒に消える */
export const deleteAgent = safeAuthAction
  .metadata({ actionName: 'deleteAgent', role: 'admin' })
  .inputSchema(scUUID)
  .action(async ({ parsedInput: { id } }) => {
    await assertAgent(id)

    await auth.api.removeUser({
      headers: await headers(),
      body: { userId: id },
    })

    logger.info({ id }, 'agent deleted')
    return { id }
  })

/**
 * 承認者(エージェントモードの変更を許可する相手)
 *
 * 1人も設定していないエージェントは、誰もエージェントモードを変更できない
 * (= そのエージェントは自動実行の承認を受けられない)。
 */

/** 設定済みの承認者。ユーザーとグループの ID をそれぞれ返す */
export const getAgentApprovers = safeAuthAction
  .metadata({ actionName: 'getAgentApprovers', role: 'admin' })
  .inputSchema(scUUID)
  .action(async ({ parsedInput: { id } }) => {
    await assertAgent(id)

    return await findAgentApprovers(id)
  })
export type GetAgentApproversReturnType = Awaited<ReturnType<typeof getAgentApprovers>>['data']

/** 承認ユーザー一覧(テーブル表示用) */
export const getAgentApproverUsers = safeAuthAction
  .metadata({ actionName: 'getAgentApproverUsers', role: 'admin' })
  .inputSchema(scUUID)
  .action(async ({ parsedInput: { id } }) => {
    await assertAgent(id)

    return await listAgentApproverUsers(id)
  })
export type GetAgentApproverUsersReturnType = Awaited<ReturnType<typeof getAgentApproverUsers>>['data']

/** 承認ユーザーを1人追加する */
export const addAgentApproverUser = safeAuthAction
  .metadata({ actionName: 'addAgentApproverUser', role: 'admin' })
  .inputSchema(scAgentApproverUser)
  .action(async ({ parsedInput: { id, userId } }) => {
    await assertAgent(id)
    await assertApproverUsersExist([userId])

    await addAgentApprover(id, userId)

    logger.info({ id, userId }, 'agent approver user added')
    return { id }
  })

/** 承認ユーザーを1人外す */
export const removeAgentApproverUser = safeAuthAction
  .metadata({ actionName: 'removeAgentApproverUser', role: 'admin' })
  .inputSchema(scAgentApproverUser)
  .action(async ({ parsedInput: { id, userId } }) => {
    await assertAgent(id)

    await removeAgentApprover(id, userId)

    logger.info({ id, userId }, 'agent approver user removed')
    return { id }
  })

/** 承認グループの保存(総入れ替え) */
export const saveAgentApproverGroups = safeAuthAction
  .metadata({ actionName: 'saveAgentApproverGroups', role: 'admin' })
  .inputSchema(scSetAgentApproverGroups)
  .action(async ({ parsedInput: { id, groupIds } }) => {
    const uniqueGroupIds = [...new Set(groupIds)]

    await assertAgent(id)
    await assertGroupsExist(uniqueGroupIds)

    await syncAgentApproverGroups(id, uniqueGroupIds)

    logger.info({ id, groups: uniqueGroupIds.length }, 'agent approver groups saved')
    return { id }
  })

/** 現在のトークン取得。平文は保持していないので、見分け用の末尾数文字だけを返す */
export const getAgentToken = safeAuthAction
  .metadata({ actionName: 'getAgentToken', role: 'admin' })
  .inputSchema(scUUID)
  .action(async ({ parsedInput: { id } }) => {
    await assertAgent(id)

    return await prisma.agentToken.findUnique({
      where: { userId: id },
      select: { hint: true, expiresAt: true, lastUsedAt: true, createdAt: true },
    })
  })
export type GetAgentTokenReturnType = Awaited<ReturnType<typeof getAgentToken>>['data']

/**
 * トークン発行。1エージェント1本なので、既にあれば置き換える(ローテート)。
 * 平文を返せるのはこの応答だけで、DB にはハッシュしか残らない。
 */
export const issueAgentToken = safeAuthAction
  .metadata({ actionName: 'issueAgentToken', role: 'admin' })
  .inputSchema(scIssueAgentToken)
  .action(async ({ ctx: { user }, parsedInput: { userId, expires } }) => {
    await assertAgent(userId)

    const { token, hint } = generateAgentToken()
    const now = nowDate()
    const data = {
      tokenHash: hashAgentToken(token),
      hint,
      expiresAt: agentTokenExpiresAt(expires, now),
      createdById: user.id,
    }
    // createdAt は発行時刻として使うので、置き換えのときも今の時刻に揃える
    const issued = await prisma.agentToken.upsert({
      where: { userId },
      create: { userId, ...data },
      update: { ...data, lastUsedAt: null, createdAt: now },
      select: { id: true },
    })

    logger.info({ agentTokenId: issued.id, userId }, 'agent token issued')
    return { token }
  })

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

    const runner = await prisma.agentRunner.findUnique({
      where: { userId: id },
      select: {
        id: true,
        enabled: true,
        activeFromMin: true,
        activeToMin: true,
        timezone: true,
        pollIntervalSec: true,
        defaultMode: true,
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
    return { ...runner, todayRuns: await countAgentRunsSince(runner.id, since) }
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
    const data = { ...rest, timezone, rule: rest.rule || null }
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

/** 承認者に指定されたユーザーの存在確認。エージェント同士は承認者にできない */
const assertApproverUsersExist = async (userIds: string[]) => {
  if (userIds.length === 0) {
    return
  }
  const count = await prisma.user.count({ where: { id: { in: userIds }, isAgent: false } })
  if (count !== userIds.length) {
    throw errInvalidOperation()
  }
}

/** グループ存在確認(渡された全 groupId が存在しなければ INVALID_OPERATION) */
const assertGroupsExist = async (groupIds: string[]) => {
  if (groupIds.length === 0) {
    return
  }
  const count = await prisma.group.count({ where: { id: { in: groupIds } } })
  if (count !== groupIds.length) {
    throw errInvalidOperation()
  }
}

/** グループの総入れ替え。ユーザー管理と同じく 2 操作だけを原子的に行う */
const syncGroups = async (userId: string, groupIds: string[]) => {
  await prisma.$transaction([
    prisma.userGroup.deleteMany({ where: { userId } }),
    ...(groupIds.length > 0
      ? [prisma.userGroup.createMany({ data: groupIds.map((groupId) => ({ userId, groupId })) })]
      : []),
  ])
}
