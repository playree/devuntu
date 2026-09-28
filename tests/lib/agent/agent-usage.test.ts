/**
 * エージェントの利用量(トークン数・コスト)の記録と、月の集計期間。
 */

import { Prisma } from '@/generated/prisma/client'
import { monthlyUsageWindow } from '@/lib/agent/agent-activity'
import { findAgentMonthlyUsage, recordAgentRunMetrics } from '@/lib/agent/agent-usage'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    agentRun: ['updateMany'],
    agentRunner: ['findUnique'],
    agentUsage: ['findFirst', 'findMany', 'create', 'update'],
  }),
)

const agentRun = vi.mocked(prisma.agentRun)
const agentRunner = vi.mocked(prisma.agentRunner)
const agentUsage = vi.mocked(prisma.agentUsage)
const tx = prisma as unknown as Prisma.TransactionClient

const runner = { id: 'r1', timezone: null, dailyResetMin: 5 * 60 }
const run = { id: 'run1', startedAt: new Date('2026-08-25T14:00:00+09:00'), boardId: 'b1' }
const now = new Date('2026-08-25T14:30:00+09:00')

beforeEach(() => {
  vi.clearAllMocks()
  agentRun.updateMany.mockResolvedValue({ count: 1 } as never)
})

describe('monthlyUsageWindow', () => {
  it('毎月1日のリセット時刻を境に月を切り替える', () => {
    expect(monthlyUsageWindow(runner, new Date('2026-09-01T05:00:00+09:00'))).toEqual({
      month: '2026-09',
      resetAt: new Date('2026-10-01T05:00:00+09:00'),
    })
  })

  it('1日のリセット時刻前は前月の期間が続いている', () => {
    expect(monthlyUsageWindow(runner, new Date('2026-09-01T04:59:00+09:00'))).toEqual({
      month: '2026-08',
      resetAt: new Date('2026-09-01T05:00:00+09:00'),
    })
  })

  it('年を跨ぐ', () => {
    expect(monthlyUsageWindow(runner, new Date('2026-12-20T12:00:00+09:00')).resetAt).toEqual(
      new Date('2027-01-01T05:00:00+09:00'),
    )
  })

  it('タイムゾーンの指定に従う', () => {
    // 2026-09-01 06:00 JST は 2026-08-31 21:00 UTC なので、UTC 基準ではまだ 8月
    expect(monthlyUsageWindow({ ...runner, timezone: 'UTC' }, new Date('2026-09-01T06:00:00+09:00')).month).toBe(
      '2026-08',
    )
  })
})

describe('recordAgentRunMetrics', () => {
  const metrics = { model: 'opus', inputTokens: 1000, cachedInputTokens: 800, outputTokens: 200, costUsd: 0.5 }

  it('実行に書き込み、月の集計行が無ければ作る', async () => {
    agentUsage.findFirst.mockResolvedValueOnce(null as never)

    expect(await recordAgentRunMetrics(tx, runner, run, { ...metrics, exitCode: 0 }, now)).toBe(true)

    expect(prisma.$queryRaw, '集計行の作成を直列にするためランナーをロックする').toHaveBeenCalled()
    expect(agentRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run1', measuredAt: null },
      data: { ...metrics, exitCode: 0, measuredAt: now },
    })
    expect(agentUsage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { runnerId: 'r1', month: '2026-08', boardId: 'b1' } }),
    )
    expect(agentUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          runnerId: 'r1',
          month: '2026-08',
          boardId: 'b1',
          runs: 1,
          inputTokens: BigInt(1000),
          cachedInputTokens: BigInt(800),
          outputTokens: BigInt(200),
          costUsd: 0.5,
        },
      }),
    )
  })

  it('集計行があれば加算する', async () => {
    agentUsage.findFirst.mockResolvedValueOnce({ id: 'u1' } as never)

    await recordAgentRunMetrics(tx, runner, run, metrics, now)

    expect(agentUsage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({ runs: { increment: 1 }, costUsd: { increment: 0.5 } }),
      }),
    )
    expect(agentUsage.create).not.toHaveBeenCalled()
  })

  it('コストの取れない実行(codex)はトークン数だけ加算する', async () => {
    agentUsage.findFirst.mockResolvedValueOnce({ id: 'u1' } as never)

    await recordAgentRunMetrics(tx, runner, run, { inputTokens: 10, outputTokens: 5 }, now)

    expect(agentUsage.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ costUsd: { increment: 0 } }) }),
    )
  })

  it('記録済みの実行には二重に加算しない', async () => {
    agentRun.updateMany.mockResolvedValueOnce({ count: 0 } as never)

    expect(await recordAgentRunMetrics(tx, runner, run, metrics, now)).toBe(false)
    expect(agentUsage.findFirst).not.toHaveBeenCalled()
  })

  it('終了コードしか無ければ集計しない', async () => {
    expect(await recordAgentRunMetrics(tx, runner, run, { exitCode: 1 }, now)).toBe(true)
    expect(agentUsage.findFirst).not.toHaveBeenCalled()
  })

  it('集計する月は実行の開始時刻で決める', async () => {
    agentUsage.findFirst.mockResolvedValueOnce(null as never)
    const lastMonth = { ...run, startedAt: new Date('2026-08-31T23:00:00+09:00') }

    await recordAgentRunMetrics(tx, runner, lastMonth, metrics, new Date('2026-09-01T06:00:00+09:00'))

    expect(agentUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ month: '2026-08' }) }),
    )
  })
})

describe('findAgentMonthlyUsage', () => {
  const row = (board: { id: string; name: string; kind: 'team' | 'private' } | null, costUsd: number) => ({
    runs: 1,
    inputTokens: BigInt(100),
    cachedInputTokens: BigInt(50),
    outputTokens: BigInt(10),
    costUsd: new Prisma.Decimal(costUsd),
    board,
  })

  it('ランナーが無ければ null', async () => {
    agentRunner.findUnique.mockResolvedValueOnce(null as never)
    expect(await findAgentMonthlyUsage('a1', now)).toBeNull()
  })

  it('合計とボード別の内訳(コストの大きい順)を返す。削除済みのボードは1行にまとめる', async () => {
    agentRunner.findUnique.mockResolvedValueOnce(runner as never)
    agentUsage.findMany.mockResolvedValueOnce([
      row({ id: 'b1', name: 'A', kind: 'team' }, 0.25),
      row(null, 0.5),
      row(null, 0.25),
      row({ id: 'b2', name: 'B', kind: 'team' }, 1),
    ] as never)

    const usage = await findAgentMonthlyUsage('a1', now)

    expect(agentUsage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { runnerId: 'r1', month: '2026-08' } }),
    )
    expect(usage?.total).toEqual({ runs: 4, inputTokens: 400, cachedInputTokens: 200, outputTokens: 40, costUsd: 2 })
    expect(usage?.boards.map((b) => [b.board?.id ?? null, b.costUsd, b.runs])).toEqual([
      ['b2', 1, 1],
      [null, 0.75, 2],
      ['b1', 0.25, 1],
    ])
  })
})
