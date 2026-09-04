/**
 * 自動運用の設定・実行履歴の入出力。
 *
 * 管理者(エージェント管理)と承認者(エージェント承認)の両方から呼ばれる共通処理なので、
 * DB を引く関数は prisma をこのファイル内で差し替えて検証する
 * (vitest.setup.ts のグローバルモックは agentRun / agentRunner を持たない)。
 */

import {
  findAgentRunnerConfig,
  listAgentRuns,
  saveAgentRunnerConfig,
  saveAgentRunnerRuleValue,
} from '@/lib/agent/agent-runner-config'
import { prisma } from '@/lib/prisma'
import { SaveAgentRunner } from '@/lib/schema/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    agentRunner: { findUnique: vi.fn(), upsert: vi.fn() },
    agentRun: { count: vi.fn(), findMany: vi.fn() },
  },
}))

const agentRunner = vi.mocked(prisma.agentRunner)
const agentRun = vi.mocked(prisma.agentRun)

beforeEach(() => {
  vi.clearAllMocks()
})

const savedRunner = {
  id: 'runner-1',
  enabled: true,
  activeFromMin: null,
  activeToMin: null,
  timezone: 'Asia/Tokyo',
  pollIntervalSec: 300,
  rule: null,
  dailyRunLimit: 0,
  dailyResetMin: 0,
  lastPolledAt: null,
  hostname: null,
  version: null,
}

const saveInput = (override: Partial<SaveAgentRunner> = {}): SaveAgentRunner => ({
  userId: 'agent-1',
  enabled: true,
  activeFromMin: null,
  activeToMin: null,
  timezone: 'Asia/Tokyo',
  pollIntervalSec: 300,
  dailyRunLimit: 0,
  dailyResetMin: 0,
  ...override,
})

describe('findAgentRunnerConfig', () => {
  it('設定行が無ければ null(= 自動運用を使わない)', async () => {
    agentRunner.findUnique.mockResolvedValue(null as never)

    await expect(findAgentRunnerConfig('agent-1')).resolves.toBeNull()
    expect(agentRun.count, '行が無ければ実行数は数えない').not.toHaveBeenCalled()
  })

  it('カウント期間の実行数を todayRuns として添える', async () => {
    agentRunner.findUnique.mockResolvedValue(savedRunner as never)
    agentRun.count.mockResolvedValue(3 as never)

    await expect(findAgentRunnerConfig('agent-1')).resolves.toMatchObject({ id: 'runner-1', todayRuns: 3 })
    expect(vi.mocked(agentRun.count).mock.calls[0][0]?.where?.runnerId, '対象は自分のランナーの実行だけ').toBe(
      'runner-1',
    )
  })
})

describe('saveAgentRunnerConfig', () => {
  it('未設定なら作成、設定済みなら更新する(upsert)', async () => {
    await saveAgentRunnerConfig(saveInput({ enabled: false }))

    const arg = vi.mocked(agentRunner.upsert).mock.calls[0][0]
    expect(arg.where).toEqual({ userId: 'agent-1' })
    expect(arg.create).toMatchObject({ userId: 'agent-1', enabled: false })
    expect(arg.update).toMatchObject({ enabled: false })
    expect(arg.update, 'ルールは専用の保存経路で扱うので触らない').not.toHaveProperty('rule')
  })

  it('IANA 名として解決できないタイムゾーンは保存しない', async () => {
    await expect(saveAgentRunnerConfig(saveInput({ timezone: 'Asia/Nowhere' }))).rejects.toThrow()
    expect(agentRunner.upsert).not.toHaveBeenCalled()
  })
})

describe('saveAgentRunnerRuleValue', () => {
  it.each([
    ['空文字', '', null],
    ['null', null, null],
    ['未指定', undefined, null],
  ])('%s は指示なし(null)として保存する', async (_label, rule, expected) => {
    await saveAgentRunnerRuleValue('agent-1', rule)

    const arg = vi.mocked(agentRunner.upsert).mock.calls[0][0]
    expect(arg.create).toEqual({ userId: 'agent-1', rule: expected })
    expect(arg.update).toEqual({ rule: expected })
  })

  it('自動運用が未設定でもルールだけ先に保存できる', async () => {
    await saveAgentRunnerRuleValue('agent-1', 'まず確認してから進める')

    expect(vi.mocked(agentRunner.upsert).mock.calls[0][0].create).toEqual({
      userId: 'agent-1',
      rule: 'まず確認してから進める',
    })
  })
})

describe('listAgentRuns', () => {
  it('設定行が無ければ履歴も無い', async () => {
    agentRunner.findUnique.mockResolvedValue(null as never)

    await expect(listAgentRuns('agent-1')).resolves.toEqual([])
    expect(agentRun.findMany).not.toHaveBeenCalled()
  })

  it('自分のランナーの実行を新しい順に上限まで返す', async () => {
    agentRunner.findUnique.mockResolvedValue({ id: 'runner-1' } as never)
    agentRun.findMany.mockResolvedValue([] as never)

    await listAgentRuns('agent-1')

    const arg = vi.mocked(agentRun.findMany).mock.calls[0][0]
    expect(arg?.where).toEqual({ runnerId: 'runner-1' })
    expect(arg?.orderBy).toEqual({ startedAt: 'desc' })
    expect(arg?.take, '件数は増え続けるので必ず絞る').toBeGreaterThan(0)
  })
})
