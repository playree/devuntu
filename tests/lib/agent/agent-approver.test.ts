import {
  addAgentApprover,
  isAgentApprover,
  listAgentApproverUsers,
  listApprovableAgents,
  removeAgentApprover,
  syncAgentApproverGroups,
} from '@/lib/agent/agent-approver'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => {
  const agentApproverGroup = { deleteMany: vi.fn(), createMany: vi.fn() }
  const $transaction = vi.fn(async (arg: unknown) => await Promise.all(arg as Promise<unknown>[]))
  return { prisma: { agentApproverGroup, $transaction } }
})

beforeEach(() => {
  vi.clearAllMocks()
})

const fakeTx = (impl: {
  count?: unknown
  findMany?: unknown
  findUnique?: unknown
  upsert?: unknown
  deleteMany?: unknown
}) => ({
  user: {
    count: vi.fn().mockResolvedValue(impl.count ?? 0),
    findMany: vi.fn().mockResolvedValue(impl.findMany ?? []),
    findUnique: vi.fn().mockResolvedValue(impl.findUnique ?? null),
  },
  agentApprover: {
    findMany: vi.fn().mockResolvedValue(impl.findMany ?? []),
    upsert: vi.fn().mockResolvedValue(impl.upsert ?? {}),
    deleteMany: vi.fn().mockResolvedValue(impl.deleteMany ?? { count: 0 }),
  },
})

describe('isAgentApprover', () => {
  it('該当行があれば承認者として扱う', async () => {
    await expect(isAgentApprover('u1', 'agent-1', fakeTx({ count: 1 }) as never)).resolves.toBe(true)
  })

  it('該当行が無ければ承認者ではない(承認者0人のエージェントを含む)', async () => {
    await expect(isAgentApprover('u1', 'agent-1', fakeTx({ count: 0 }) as never)).resolves.toBe(false)
  })

  it('エージェントであることと、直接指定 / グループ経由の両方を条件に入れる', async () => {
    const tx = fakeTx({ count: 1 })
    await isAgentApprover('u1', 'agent-1', tx as never)

    const where = vi.mocked(tx.user.count).mock.calls[0][0].where
    expect(where.id, '対象はエージェントユーザー自身').toBe('agent-1')
    expect(where.isAgent, '人間のユーザーを承認対象にしない').toBe(true)
    expect(where.OR, '直接指定とグループ経由の 2 条件').toHaveLength(2)
  })
})

describe('listApprovableAgents', () => {
  it('エージェントのみを名前順で引く', async () => {
    const tx = fakeTx({ findMany: [{ id: 'agent-1', name: 'A' }] })
    await expect(listApprovableAgents('u1', tx as never)).resolves.toEqual([{ id: 'agent-1', name: 'A' }])

    const args = vi.mocked(tx.user.findMany).mock.calls[0][0]
    expect(args.where.isAgent).toBe(true)
    expect(args.orderBy).toEqual({ name: 'asc' })
  })
})

describe('addAgentApprover', () => {
  it('複合キーで upsert する(二重押下しても行が増えない)', async () => {
    const tx = fakeTx({})
    await addAgentApprover('agent-1', 'u1', tx as never)

    const args = vi.mocked(tx.agentApprover.upsert).mock.calls[0][0]
    expect(args.where).toEqual({ agentId_userId: { agentId: 'agent-1', userId: 'u1' } })
    expect(args.create).toEqual({ agentId: 'agent-1', userId: 'u1' })
  })
})

describe('removeAgentApprover', () => {
  it('agentId と userId で行を削除する', async () => {
    const tx = fakeTx({})
    await removeAgentApprover('agent-1', 'u1', tx as never)

    const args = vi.mocked(tx.agentApprover.deleteMany).mock.calls[0][0]
    expect(args.where).toEqual({ agentId: 'agent-1', userId: 'u1' })
  })
})

describe('listAgentApproverUsers', () => {
  const user = (id: string, name: string) => ({ id, name, email: `${id}@example.com` })

  it('直接指定のみの場合、via: user で返す', async () => {
    const tx = fakeTx({
      findUnique: { agentApprovers: [{ user: user('u1', 'A') }], agentApproverGroups: [] },
    })
    await expect(listAgentApproverUsers('agent-1', tx as never)).resolves.toEqual([{ ...user('u1', 'A'), via: 'user' }])

    const args = vi.mocked(tx.user.findUnique).mock.calls[0][0]
    expect(args.where).toEqual({ id: 'agent-1' })
  })

  it('グループ経由のみの場合、via: group で返す', async () => {
    const tx = fakeTx({
      findUnique: {
        agentApprovers: [],
        agentApproverGroups: [{ group: { userGroups: [{ user: user('u2', 'B') }] } }],
      },
    })
    await expect(listAgentApproverUsers('agent-1', tx as never)).resolves.toEqual([
      { ...user('u2', 'B'), via: 'group' },
    ])
  })

  it('直接指定とグループ経由で同じユーザーが重複する場合、直接指定(via: user)を優先する', async () => {
    const tx = fakeTx({
      findUnique: {
        agentApprovers: [{ user: user('u1', 'A') }],
        agentApproverGroups: [{ group: { userGroups: [{ user: user('u1', 'A') }] } }],
      },
    })
    await expect(listAgentApproverUsers('agent-1', tx as never)).resolves.toEqual([{ ...user('u1', 'A'), via: 'user' }])
  })

  it('名前順でソートして返す', async () => {
    const tx = fakeTx({
      findUnique: { agentApprovers: [{ user: user('u2', 'B') }, { user: user('u1', 'A') }], agentApproverGroups: [] },
    })
    await expect(listAgentApproverUsers('agent-1', tx as never)).resolves.toEqual([
      { ...user('u1', 'A'), via: 'user' },
      { ...user('u2', 'B'), via: 'user' },
    ])
  })

  it('対象のエージェントが存在しなければ空配列を返す', async () => {
    const tx = fakeTx({ findUnique: null })
    await expect(listAgentApproverUsers('agent-1', tx as never)).resolves.toEqual([])
  })
})

describe('syncAgentApproverGroups', () => {
  it('全削除してから指定したグループを作成する', async () => {
    await syncAgentApproverGroups('agent-1', ['g1', 'g2'])

    expect(prisma.$transaction).toHaveBeenCalled()
    expect(prisma.agentApproverGroup.deleteMany).toHaveBeenCalledWith({ where: { agentId: 'agent-1' } })
    expect(prisma.agentApproverGroup.createMany).toHaveBeenCalledWith({
      data: [
        { agentId: 'agent-1', groupId: 'g1' },
        { agentId: 'agent-1', groupId: 'g2' },
      ],
    })
  })

  it('groupIds が空なら createMany を呼ばない', async () => {
    await syncAgentApproverGroups('agent-1', [])

    expect(prisma.agentApproverGroup.deleteMany).toHaveBeenCalledWith({ where: { agentId: 'agent-1' } })
    expect(prisma.agentApproverGroup.createMany).not.toHaveBeenCalled()
  })
})
