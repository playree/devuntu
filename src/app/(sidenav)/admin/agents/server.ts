'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { agentEmail, agentRunnerStatus, DUPLICATED_AGENT_HANDLE } from '@/lib/agent/agent'
import { auth } from '@/lib/auth/auth'
import { nowDate } from '@/lib/day'
import { errClient, errInvalidOperation, errSystemError } from '@/lib/error'
import { logger } from '@/lib/logger'
import { isUniqueViolation, prisma } from '@/lib/prisma'
import { scCreateAgent } from '@/lib/schema/schema'
import { isAPIError } from 'better-auth/api'
import { headers } from 'next/headers'

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

/** 一覧に出すトークンの状態。エージェントは1本しか持たないので件数ではなく状態で表す */
export type AgentTokenStatus = 'none' | 'active' | 'expired'

/** エージェント一覧取得 */
export const getAgents = safeAuthAction.metadata({ actionName: 'getAgents', role: 'admin' }).action(async () => {
  const now = nowDate()
  const agents = await prisma.user.findMany({
    where: { isAgent: true },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      userGroups: { select: { group: { select: { id: true, name: true } } } },
      agentToken: { select: { lastUsedAt: true, expiresAt: true } },
      agentRunner: { select: { enabled: true, pollIntervalSec: true, lastPolledAt: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return agents.map(({ userGroups, agentToken, agentRunner, ...agent }) => {
    const tokenStatus: AgentTokenStatus = !agentToken
      ? 'none'
      : agentToken.expiresAt && agentToken.expiresAt <= now
        ? 'expired'
        : 'active'
    return {
      ...agent,
      groups: userGroups.map((ug) => ug.group),
      tokenStatus,
      lastUsedAt: agentToken?.lastUsedAt ?? null,
      runnerStatus: agentRunnerStatus(agentRunner, now),
    }
  })
})
export type GetAgentsReturnType = Awaited<ReturnType<typeof getAgents>>['data']

/** グループ選択肢取得(id: name のマップ) */
export const getGroupOptions = safeAuthAction
  .metadata({ actionName: 'getAgentGroupOptions', role: 'admin' })
  .action(async () => {
    const groups = await prisma.group.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
    return Object.fromEntries(groups.map((g) => [g.id, g.name])) as Record<string, string>
  })

/**
 * エージェント作成。
 *
 * ユーザーの自動作成は `databaseHooks.user.create.before` が `/admin/create-user` 以外を弾くため、
 * 人間のユーザーと同じく `auth.api.createUser` を通す。パスワードは持たせず、作成直後に
 * エージェント印(`isAgent`)を立てる。
 */
export const createAgent = safeAuthAction
  .metadata({ actionName: 'createAgent', role: 'admin' })
  .inputSchema(scCreateAgent)
  .action(async ({ parsedInput: { name, handle, groups } }) => {
    const groupIds = [...new Set(groups)]
    const email = agentEmail(handle)

    await assertGroupsExist(groupIds)

    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw errClient(DUPLICATED_AGENT_HANDLE)
    }

    const { user } = await auth.api
      .createUser({
        headers: await headers(),
        body: { email, name, role: 'user' },
      })
      // 事前確認からここまでの間に同じ識別子が作られた場合
      .catch((e: unknown) => {
        if (isUniqueViolation(e) || (isAPIError(e) && e.status === 'BAD_REQUEST')) {
          throw errClient(DUPLICATED_AGENT_HANDLE)
        }
        throw e
      })

    if (!user) {
      throw errSystemError('agent create failed')
    }

    // エージェント印とメール検証済みを立てる。検証メールは届かないので発行させない
    await prisma
      .$transaction([
        prisma.user.update({ where: { id: user.id }, data: { isAgent: true, emailVerified: true } }),
        ...(groupIds.length > 0
          ? [prisma.userGroup.createMany({ data: groupIds.map((groupId) => ({ userId: user.id, groupId })) })]
          : []),
      ])
      // エージェント印の付かないユーザーが残ると /admin/users に現れ、同じ識別子で作り直せなくなる
      .catch(async (e: unknown) => {
        await auth.api
          .removeUser({ headers: await headers(), body: { userId: user.id } })
          .catch((error: unknown) => logger.error({ error, userId: user.id }, 'agent rollback failed'))
        throw e
      })

    logger.info({ agent: { id: user.id, email }, groups: groupIds }, 'agent created')
    return { id: user.id, name: user.name }
  })
