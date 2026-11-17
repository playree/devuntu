/**
 * 中断した実行の復旧(停止・runId 指定の報告・再実行・取得)の単体テスト
 *
 * agent-run.ts の `cancelAgentRun` / `finishAgentTask`(runId 指定)と、agent-run-recovery.ts を見る。
 * 実行の開始・通常の終了は agent-runner.test.ts の担当。
 */

import { Prisma } from '@/generated/prisma/client'
import { cancelAgentRun, finishAgentTask } from '@/lib/agent/agent-run'
import {
  cancelAgentTicketRun,
  findRunnerAgentRun,
  listRunnerAgentRuns,
  retryAgentTicket,
} from '@/lib/agent/agent-run-recovery'
import { type AgentRunnerRow } from '@/lib/agent/agent-runner'
import { assertTicketAccess, type TicketAccess } from '@/lib/board/board-access'
import { ClientError } from '@/lib/error'
import { enqueueAgentRunFinished } from '@/lib/notify/notify-trigger'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/notify/notify-trigger', () => ({ enqueueAgentRunFinished: vi.fn(), enqueueTicketMoved: vi.fn() }))
vi.mock('@/lib/board/board-access', () => ({ assertTicketAccess: vi.fn() }))

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    ticket: ['findUnique', 'findUniqueOrThrow', 'update', 'updateMany'],
    agentRun: ['findMany', 'findFirst', 'findUnique', 'updateMany'],
    agentAutoReviseTrigger: ['updateMany'],
    ticketCriterion: ['count', 'update'],
  }),
)

const ticket = vi.mocked(prisma.ticket)
const agentRun = vi.mocked(prisma.agentRun)
const trigger = vi.mocked(prisma.agentAutoReviseTrigger)
const notifyMock = vi.mocked(enqueueAgentRunFinished)

const runner = (): AgentRunnerRow => ({
  id: 'r1',
  userId: 'a1',
  enabled: true,
  activeFromMin: null,
  activeToMin: null,
  timezone: null,
  pollIntervalSec: 300,
  rule: null,
  dailyRunLimit: 0,
  dailyResetMin: 5 * 60,
  monthlyBudgetUsd: new Prisma.Decimal(0),
  user: { name: 'テストエージェント' },
})

const runningRun = (override: Record<string, unknown> = {}) => ({
  id: 'run1',
  runnerId: 'r1',
  ticketId: 't1',
  action: 'execute',
  startedAt: new Date('2026-08-25T00:00:00Z'),
  ticket: { id: 't1', boardId: 'b1', number: 42, title: 'テストチケット', board: { key: 'ABC' } },
  runner: { user: { name: 'テストエージェント' } },
  ...override,
})

const access = { ticketId: 't1', boardId: 'b1', assigneeId: 'a1', assigneeIsAgent: true } as TicketAccess

beforeEach(() => {
  vi.clearAllMocks()
  // 呼ばれずに残った mockResolvedValueOnce を次のテストへ持ち越さない
  for (const model of [ticket, agentRun, trigger]) {
    Object.values(model).forEach((fn) => vi.mocked(fn as () => unknown).mockReset())
  }
  agentRun.updateMany.mockResolvedValue({ count: 1 } as never)
  vi.mocked(assertTicketAccess).mockResolvedValue(access)
})

describe('cancelAgentRun', () => {
  it('実行中の実行を failed(canceled)で閉じ、チケットを失敗にして通知する', async () => {
    agentRun.findUnique.mockResolvedValueOnce(runningRun() as never)

    expect(await cancelAgentRun({ runId: 'run1', runnerId: 'r1' })).toBe('canceled')
    expect(agentRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run1', status: 'running' },
      data: { status: 'failed', finishedAt: expect.any(Date), summary: 'canceled' },
    })
    expect(ticket.updateMany).toHaveBeenCalledWith({
      where: { id: 't1', agentState: 'running' },
      // 実行の失敗では返答待ちの起点(agentStateAt)を動かさない
      data: { agentState: 'failed' },
    })
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run1', status: 'failed', state: 'failed', summary: 'canceled' }),
      expect.anything(),
    )
  })

  it('他のランナーの実行は見つからないものとして扱う', async () => {
    agentRun.findUnique.mockResolvedValueOnce(runningRun({ runnerId: 'r2' }) as never)

    expect(await cancelAgentRun({ runId: 'run1', runnerId: 'r1' })).toBe('not_found')
    expect(agentRun.updateMany).not.toHaveBeenCalled()
  })

  it('既に閉じた実行は何も変えず、通知もしない', async () => {
    agentRun.findUnique.mockResolvedValueOnce(runningRun() as never)
    agentRun.updateMany.mockResolvedValueOnce({ count: 0 } as never)

    expect(await cancelAgentRun({ runId: 'run1', runnerId: 'r1' })).toBe('not_running')
    expect(ticket.updateMany).not.toHaveBeenCalled()
    expect(notifyMock).not.toHaveBeenCalled()
  })
})

describe('finishAgentTask(runId 指定)', () => {
  it('指定の実行だけを閉じる', async () => {
    agentRun.findFirst.mockResolvedValueOnce({ id: 'run2', action: 'execute' } as never)
    ticket.update.mockResolvedValueOnce(runningRun().ticket as never)

    expect(await finishAgentTask(runner(), 't1', 'completed', null, [], 'run2')).toEqual({ state: 'done' })
    expect(agentRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { runnerId: 'r1', ticketId: 't1', status: 'running', id: 'run2' } }),
    )
    expect(agentRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'run2', status: 'running' } }),
    )
  })

  it('閉じ済み・別チケットの実行への遅れた報告は、状態も実行も変えない', async () => {
    agentRun.findFirst.mockResolvedValueOnce(null as never)
    ticket.findUnique.mockResolvedValueOnce({ agentState: 'running' } as never)

    expect(await finishAgentTask(runner(), 't1', 'completed', '要約', [], 'run-old')).toEqual({
      state: 'running',
      stale: true,
    })
    expect(agentRun.updateMany).not.toHaveBeenCalled()
    expect(ticket.update).not.toHaveBeenCalled()
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('読み出しの後に停止で閉じられた実行への報告も stale を返す', async () => {
    agentRun.findFirst.mockResolvedValueOnce({ id: 'run2', action: 'execute' } as never)
    agentRun.updateMany.mockResolvedValueOnce({ count: 0 } as never)
    ticket.findUnique.mockResolvedValueOnce({ agentState: 'failed' } as never)

    expect(await finishAgentTask(runner(), 't1', 'completed', null, [], 'run2')).toEqual({
      state: 'failed',
      stale: true,
    })
    expect(ticket.update).not.toHaveBeenCalled()
  })

  it('自動運用の設定が無くても、runId を指定した報告は閉じられないなら何も変えない', async () => {
    ticket.findUnique.mockResolvedValueOnce({ agentState: 'failed' } as never)

    expect(await finishAgentTask(null, 't1', 'completed', null, [], 'run-old')).toEqual({
      state: 'failed',
      stale: true,
    })
    expect(ticket.update).not.toHaveBeenCalled()
  })

  it('runId 無しで停止直後に届いた報告は、failed を上書きしない', async () => {
    agentRun.findFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ status: 'failed', summary: 'canceled', finishedAt: new Date() } as never)
    ticket.findUnique.mockResolvedValueOnce({ agentState: 'failed' } as never)

    expect(await finishAgentTask(runner(), 't1', 'completed')).toEqual({ state: 'failed' })
    expect(ticket.update).not.toHaveBeenCalled()
  })
})

describe('retryAgentTicket', () => {
  const setup = (agentState: string | null, latest: unknown, running: unknown = null) => {
    ticket.findUniqueOrThrow.mockResolvedValueOnce({ agentMode: 'plan', agentState, agentStateAt: new Date() } as never)
    agentRun.findFirst.mockResolvedValueOnce(running as never).mockResolvedValueOnce(latest as never)
  }

  it('直近の実行が revise でなければ処理待ちへ戻す', async () => {
    setup('failed', { id: 'run1', action: 'plan', startedAt: new Date() })

    expect(await retryAgentTicket({ id: 'u1' }, 't1')).toEqual({ state: 'queued' })
    expect(assertTicketAccess).toHaveBeenCalledWith({ id: 'u1' }, 't1', 'agentMode', expect.anything())
    expect(ticket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { agentState: 'queued', agentStateAt: expect.any(Date) },
    })
    expect(trigger.updateMany).not.toHaveBeenCalled()
  })

  it('直近の実行が revise なら返信待ちへ戻し、元の返信・自動差し戻しで拾い直せるようにする', async () => {
    setup('skipped', { id: 'run1', action: 'revise' })

    expect(await retryAgentTicket({ id: 'u1' }, 't1')).toEqual({ state: 'planned' })
    expect(ticket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      // 返答待ちに入った時刻(agentStateAt)は残したまま戻す
      data: { agentState: 'planned' },
    })
    expect(trigger.updateMany).toHaveBeenCalledWith({
      where: { runId: 'run1' },
      data: { runId: null, consumed: false },
    })
  })

  it('返答待ちの時刻が無い(導入前の)チケットは、revise の実行の開始時刻を返答待ちの時刻とみなす', async () => {
    const startedAt = new Date('2026-08-25T00:00:00Z')
    ticket.findUniqueOrThrow.mockResolvedValueOnce({
      agentMode: 'plan',
      agentState: 'failed',
      agentStateAt: null,
    } as never)
    agentRun.findFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: 'run1', action: 'revise', startedAt } as never)

    expect(await retryAgentTicket({ id: 'u1' }, 't1')).toEqual({ state: 'planned' })
    expect(ticket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { agentState: 'planned', agentStateAt: startedAt },
    })
  })

  it('実行中の実行が残っている間は再実行できない', async () => {
    setup('failed', null, { id: 'run1' })

    await expect(retryAgentTicket({ id: 'u1' }, 't1')).rejects.toBeInstanceOf(ClientError)
    expect(ticket.update).not.toHaveBeenCalled()
  })

  it.each(['running', 'planned', 'done', null])('処理状態が %s なら再実行できない', async (state) => {
    setup(state, null)

    await expect(retryAgentTicket({ id: 'u1' }, 't1')).rejects.toBeInstanceOf(ClientError)
    expect(ticket.update).not.toHaveBeenCalled()
  })

  it('担当がエージェントでなければ再実行できない', async () => {
    vi.mocked(assertTicketAccess).mockResolvedValueOnce({ ...access, assigneeIsAgent: false })

    await expect(retryAgentTicket({ id: 'u1' }, 't1')).rejects.toBeInstanceOf(ClientError)
    expect(ticket.update).not.toHaveBeenCalled()
  })
})

describe('cancelAgentTicketRun', () => {
  it('承認者の権限を確かめてから、チケットの実行中の実行を停止する', async () => {
    agentRun.findFirst.mockResolvedValueOnce({ id: 'run1' } as never)
    agentRun.findUnique.mockResolvedValueOnce(runningRun() as never)

    expect(await cancelAgentTicketRun({ id: 'u1' }, 't1')).toEqual({ runId: 'run1' })
    expect(assertTicketAccess).toHaveBeenCalledWith({ id: 'u1' }, 't1', 'agentMode', expect.anything())
    expect(agentRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ summary: 'canceled' }) }),
    )
  })

  it('実行中の実行が無ければエラー', async () => {
    agentRun.findFirst.mockResolvedValueOnce(null as never)

    await expect(cancelAgentTicketRun({ id: 'u1' }, 't1')).rejects.toBeInstanceOf(ClientError)
  })
})

describe('listRunnerAgentRuns / findRunnerAgentRun', () => {
  it('自分のランナーの実行だけを条件で絞って返す', async () => {
    agentRun.findMany.mockResolvedValueOnce([] as never)

    await listRunnerAgentRuns('r1', { status: 'running', requestId: 'req-1', limit: 5 })
    expect(agentRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runnerId: 'r1', status: 'running', requestId: 'req-1' },
        orderBy: { startedAt: 'desc' },
        take: 5,
      }),
    )
  })

  it('1 件の取得もランナーで絞る(他のランナーの実行は null)', async () => {
    agentRun.findFirst.mockResolvedValueOnce(null as never)

    expect(await findRunnerAgentRun('r1', 'run9')).toBeNull()
    expect(agentRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'run9', runnerId: 'r1' } }))
  })
})
