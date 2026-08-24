'use server'

import { safeAuthAction } from '@/lib/action-server'
import { agentEmail, agentTokenExpiresAt, DUPLICATED_AGENT_HANDLE } from '@/lib/agent'
import { generateAgentToken, hashAgentToken } from '@/lib/agent-token'
import { auth } from '@/lib/auth'
import { nowDate } from '@/lib/day'
import { errClient, errInvalidOperation, errSystemError } from '@/lib/error'
import { logger } from '@/lib/logger'
import { isUniqueViolation, prisma } from '@/lib/prisma'
import { scCreateAgent, scIssueAgentToken, scUpdateAgent, scUUID } from '@/lib/schema'
import { isAPIError } from 'better-auth/api'
import { headers } from 'next/headers'

/** 一覧・更新の対象がエージェントであることを確かめる。人間のユーザーはこの画面から触れない */
const assertAgent = async (id: string) => {
  const user = await prisma.user.findUnique({ where: { id }, select: { isAgent: true } })
  if (!user?.isAgent) {
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

/**
 * エージェント一覧取得。
 * トークン数は失効・期限切れを除いた「今使えるもの」だけを数える。
 */
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
      agentTokens: { select: { lastUsedAt: true, revokedAt: true, expiresAt: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return agents.map(({ userGroups, agentTokens, ...agent }) => {
    const active = agentTokens.filter((token) => !token.revokedAt && (!token.expiresAt || token.expiresAt > now))
    const lastUsedAt = agentTokens.reduce<Date | null>(
      (latest, token) => (token.lastUsedAt && (!latest || token.lastUsedAt > latest) ? token.lastUsedAt : latest),
      null,
    )
    return {
      ...agent,
      groups: userGroups.map((ug) => ug.group),
      tokenCount: active.length,
      lastUsedAt,
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
    await prisma.user.update({ where: { id: user.id }, data: { isAgent: true, emailVerified: true } })

    if (groupIds.length > 0) {
      await prisma.userGroup.createMany({ data: groupIds.map((groupId) => ({ userId: user.id, groupId })) })
    }

    logger.info({ agent: { id: user.id, email }, groups: groupIds }, 'agent created')
    return { id: user.id, name: user.name }
  })

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

/** トークン一覧取得。平文は保持していないので、見分け用の末尾数文字だけを返す */
export const getAgentTokens = safeAuthAction
  .metadata({ actionName: 'getAgentTokens', role: 'admin' })
  .inputSchema(scUUID)
  .action(async ({ parsedInput: { id } }) => {
    await assertAgent(id)

    const tokens = await prisma.agentToken.findMany({
      where: { userId: id },
      select: {
        id: true,
        name: true,
        hint: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
    return tokens
  })
export type GetAgentTokensReturnType = Awaited<ReturnType<typeof getAgentTokens>>['data']

/** トークン発行。平文を返せるのはこの応答だけで、DB にはハッシュしか残らない */
export const issueAgentToken = safeAuthAction
  .metadata({ actionName: 'issueAgentToken', role: 'admin' })
  .inputSchema(scIssueAgentToken)
  .action(async ({ ctx: { user }, parsedInput: { userId, name, expires } }) => {
    await assertAgent(userId)

    const { token, hint } = generateAgentToken()
    const created = await prisma.agentToken.create({
      data: {
        userId,
        name,
        tokenHash: hashAgentToken(token),
        hint,
        expiresAt: agentTokenExpiresAt(expires, nowDate()),
        createdById: user.id,
      },
      select: { id: true },
    })

    logger.info({ agentTokenId: created.id, userId }, 'agent token issued')
    return { token }
  })

/** トークン失効。監査のため行は残し、`revokedAt` で止める */
export const revokeAgentToken = safeAuthAction
  .metadata({ actionName: 'revokeAgentToken', role: 'admin' })
  .inputSchema(scUUID)
  .action(async ({ parsedInput: { id } }) => {
    const target = await prisma.agentToken.findUnique({ where: { id }, select: { revokedAt: true } })
    if (!target || target.revokedAt) {
      throw errInvalidOperation()
    }

    await prisma.agentToken.update({ where: { id }, data: { revokedAt: nowDate() } })

    logger.info({ agentTokenId: id }, 'agent token revoked')
    return { id }
  })
