/**
 * エージェントの承認者(サーバー専用)
 *
 * 承認者は「チケットのエージェントモードを変更してよい相手」= 自動実行を承認できる相手。
 * ボードの権限とは独立した軸なので、ここに判定と設定の入口をまとめる。
 * 承認者が1人も居ないエージェントは、誰もエージェントモードを変更できない。
 */

import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '../prisma'

type Db = Prisma.TransactionClient | typeof prisma

/** 承認者の判定条件。直接指定(AgentApprover)とグループ経由(AgentApproverGroup)の OR */
const approverWhere = (userId: string): Prisma.UserWhereInput['OR'] => [
  { agentApprovers: { some: { userId } } },
  { agentApproverGroups: { some: { group: { userGroups: { some: { userId } } } } } },
]

/** `userId` が `agentId` の承認者かどうか。エージェント以外のユーザーは常に false */
export const isAgentApprover = async (userId: string, agentId: string, tx: Db = prisma): Promise<boolean> => {
  const count = await tx.user.count({
    where: { id: agentId, isAgent: true, OR: approverWhere(userId) },
  })
  return count > 0
}

export type ApprovableAgent = { id: string; name: string }

/** `userId` が承認者になっているエージェントの一覧。承認画面のエージェント選択に使う */
export const listApprovableAgents = async (userId: string, tx: Db = prisma): Promise<ApprovableAgent[]> =>
  await tx.user.findMany({
    where: { isAgent: true, OR: approverWhere(userId) },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

export type AgentApprovers = { userIds: string[]; groupIds: string[] }

/**
 * エージェントに設定済みの承認者(ID のみ)。
 * 承認ユーザーテーブルの候補フィルタ、承認グループフォームの初期値、未設定警告の判定に使う
 */
export const getAgentApprovers = async (agentId: string, tx: Db = prisma): Promise<AgentApprovers> => {
  const [users, groups] = await Promise.all([
    tx.agentApprover.findMany({ where: { agentId }, select: { userId: true } }),
    tx.agentApproverGroup.findMany({ where: { agentId }, select: { groupId: true } }),
  ])
  return { userIds: users.map((u) => u.userId), groupIds: groups.map((g) => g.groupId) }
}

export type AgentApproverUser = { id: string; name: string; email: string; via: 'user' | 'group' }

/** 承認ユーザー一覧(表示用)。直接指定 + 承認グループ経由を統合し、名前順で返す。重複時は直接指定を優先する */
export const listAgentApproverUsers = async (agentId: string, tx: Db = prisma): Promise<AgentApproverUser[]> => {
  const agent = await tx.user.findUnique({
    where: { id: agentId },
    select: {
      agentApprovers: { select: { user: { select: { id: true, name: true, email: true } } } },
      agentApproverGroups: {
        select: {
          group: { select: { userGroups: { select: { user: { select: { id: true, name: true, email: true } } } } } },
        },
      },
    },
  })
  if (!agent) {
    return []
  }

  const users = new Map<string, AgentApproverUser>()
  for (const { user } of agent.agentApprovers) {
    users.set(user.id, { ...user, via: 'user' })
  }
  for (const { group } of agent.agentApproverGroups) {
    for (const { user } of group.userGroups) {
      if (!users.has(user.id)) {
        users.set(user.id, { ...user, via: 'group' })
      }
    }
  }

  return [...users.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** 承認ユーザーを1人追加する。既に承認者なら何もしない */
export const addAgentApprover = async (agentId: string, userId: string, tx: Db = prisma): Promise<void> => {
  await tx.agentApprover.upsert({
    where: { agentId_userId: { agentId, userId } },
    create: { agentId, userId },
    update: {},
  })
}

/** 承認ユーザーを1人外す */
export const removeAgentApprover = async (agentId: string, userId: string, tx: Db = prisma): Promise<void> => {
  await tx.agentApprover.deleteMany({ where: { agentId, userId } })
}

/** 承認グループの総入れ替え。ユーザー管理のグループ設定と同じく、削除と作成を原子的に行う */
export const syncAgentApproverGroups = async (agentId: string, groupIds: string[]): Promise<void> => {
  await prisma.$transaction([
    prisma.agentApproverGroup.deleteMany({ where: { agentId } }),
    ...(groupIds.length > 0
      ? [prisma.agentApproverGroup.createMany({ data: groupIds.map((groupId) => ({ agentId, groupId })) })]
      : []),
  ])
}
