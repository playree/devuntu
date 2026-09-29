/**
 * 自動運用の中核ロジック。
 *
 * 稼働条件の判定は純粋関数なので実時刻を渡して検証し、DB を引く関数は prisma をこのファイル内で
 * 差し替える(vitest.setup.ts のグローバルモックは agentRun / agentRunner を持たない)。
 */

import { Prisma } from '@/generated/prisma/client'
import {
  activeWindowLabel,
  dailyRunWindow,
  evaluateRunner,
  evaluateRunnerActivity,
  isWithinActiveWindow,
} from '@/lib/agent/agent-activity'
import { consumeAutoReviseTriggers, hasSettledAutoRevise, hasUnsettledAutoRevise } from '@/lib/agent/agent-auto-revise'
import { failStaleAgentRuns, finishAgentRunById, finishAgentTask, startAgentRun } from '@/lib/agent/agent-run'
import { type AgentRunnerRow } from '@/lib/agent/agent-runner'
import { pickAgentTasks, resolveAgentTask } from '@/lib/agent/agent-task'
import { findWaitingTicketIds } from '@/lib/board/ticket-sequence'
import { ClientError } from '@/lib/error'
import { enqueueAgentRunFinished } from '@/lib/notify/notify-trigger'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 通知は実行を閉じたことの副作用。ここでは「どう呼ばれたか」だけを見る
vi.mock('@/lib/notify/notify-trigger', () => ({ enqueueAgentRunFinished: vi.fn() }))

// 順番待ちの判定は ticket-sequence.test.ts で見る。ここでは結果を待ち行列から外すことだけを確かめる
vi.mock('@/lib/board/ticket-sequence', () => ({ findWaitingTicketIds: vi.fn(async () => new Set()) }))

// 自動差し戻しの判定は agent-auto-revise.test.ts で見る。ここでは結果の使われ方だけを確かめる
vi.mock('@/lib/agent/agent-auto-revise', () => ({
  hasSettledAutoRevise: vi.fn(async () => false),
  hasUnsettledAutoRevise: vi.fn(async () => false),
  consumeAutoReviseTriggers: vi.fn(),
}))

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    ticket: ['findMany', 'findFirst', 'findUnique', 'update', 'updateMany'],
    ticketComment: ['findFirst'],
    agentRun: ['count', 'findMany', 'findFirst', 'findUnique', 'create', 'update', 'updateMany'],
    agentRunner: ['findUnique', 'update'],
    agentUsage: ['aggregate', 'findFirst', 'create', 'update'],
    ticketCriterion: ['count', 'update'],
  }),
)

const ticket = vi.mocked(prisma.ticket)
const ticketComment = vi.mocked(prisma.ticketComment)
const agentRun = vi.mocked(prisma.agentRun)
const ticketCriterion = vi.mocked(prisma.ticketCriterion)
const agentUsage = vi.mocked(prisma.agentUsage)

/** 今月のコストの合計として aggregate が返す値 */
const monthCost = (usd: number) =>
  agentUsage.aggregate.mockResolvedValue({ _sum: { costUsd: new Prisma.Decimal(usd) } } as never)

const notifyMock = vi.mocked(enqueueAgentRunFinished)

/** 通知の宛先と文面を組み立てるためにチケットへ足した select */
const notifyTicket = () => ({
  id: 't1',
  boardId: 'b1',
  number: 42,
  title: 'テストチケット',
  board: { key: 'ABC' },
})

const runner = (override: Partial<AgentRunnerRow> = {}): AgentRunnerRow => ({
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
  ...override,
})

/** JST は UTC+9 なので、指定の JST 時刻に相当する UTC の瞬間を作る */
const jst = (hhmm: string) => new Date(`2026-08-25T${hhmm}:00+09:00`)

beforeEach(() => {
  vi.clearAllMocks()
  // 実行を閉じるのは status: 'running' の条件付き更新。既定はクローズ権を取得できたことにし、
  // 競合を再現するテストだけ count: 0 を返させる
  agentRun.updateMany.mockResolvedValue({ count: 1 } as never)
})

describe('isWithinActiveWindow', () => {
  it('時間帯が未設定なら終日稼働できる', () => {
    expect(isWithinActiveWindow(runner(), jst('03:00'))).toBe(true)
  })

  it('開始と終了が同じ場合も終日として扱う', () => {
    expect(isWithinActiveWindow(runner({ activeFromMin: 540, activeToMin: 540 }), jst('03:00'))).toBe(true)
  })

  it('日中の時間帯は内側だけ稼働できる', () => {
    const window = runner({ activeFromMin: 9 * 60, activeToMin: 18 * 60 })
    expect(isWithinActiveWindow(window, jst('12:00'))).toBe(true)
    expect(isWithinActiveWindow(window, jst('08:59'))).toBe(false)
  })

  it('終了時刻ちょうどは含めない', () => {
    const window = runner({ activeFromMin: 9 * 60, activeToMin: 18 * 60 })
    expect(isWithinActiveWindow(window, jst('18:00'))).toBe(false)
    expect(isWithinActiveWindow(window, jst('17:59'))).toBe(true)
  })

  it('開始 > 終了は日跨ぎ(夜間のみ)として扱う', () => {
    const window = runner({ activeFromMin: 22 * 60, activeToMin: 6 * 60 })
    expect(isWithinActiveWindow(window, jst('23:00'))).toBe(true)
    expect(isWithinActiveWindow(window, jst('02:00'))).toBe(true)
    expect(isWithinActiveWindow(window, jst('14:00'))).toBe(false)
  })

  it('タイムゾーンの指定に従う', () => {
    const window = runner({ activeFromMin: 9 * 60, activeToMin: 18 * 60, timezone: 'UTC' })
    // 12:00 JST は 03:00 UTC なので UTC 基準では時間帯の外
    expect(isWithinActiveWindow(window, jst('12:00'))).toBe(false)
    expect(isWithinActiveWindow(window, jst('21:00'))).toBe(true)
  })
})

describe('activeWindowLabel', () => {
  it('終日の場合は null', () => {
    expect(activeWindowLabel(runner())).toBeNull()
  })

  it('時間帯は HH:mm とタイムゾーンで返す', () => {
    expect(activeWindowLabel(runner({ activeFromMin: 22 * 60, activeToMin: 6 * 60 }))).toEqual({
      from: '22:00',
      to: '06:00',
      timezone: 'Asia/Tokyo',
    })
  })
})

describe('evaluateRunner', () => {
  it('設定が無ければ稼働できない', () => {
    expect(evaluateRunner(null)).toEqual({ active: false, reason: 'no_runner' })
  })

  it('無効なら稼働できない', () => {
    expect(evaluateRunner(runner({ enabled: false }))).toEqual({ active: false, reason: 'disabled' })
  })

  it('時間帯の外なら稼働できない', () => {
    const target = runner({ activeFromMin: 22 * 60, activeToMin: 6 * 60 })
    expect(evaluateRunner(target, jst('14:00'))).toEqual({ active: false, reason: 'outside_hours' })
  })

  it('有効かつ時間帯の内側なら稼働できる', () => {
    expect(evaluateRunner(runner(), jst('14:00'))).toEqual({ active: true, reason: null })
  })
})

describe('dailyRunWindow', () => {
  it('リセット時刻を過ぎていればその日の分から数える', () => {
    const { since, resetAt } = dailyRunWindow(runner(), jst('05:00'))
    expect(since.toISOString()).toBe(new Date('2026-08-25T05:00:00+09:00').toISOString())
    expect(resetAt.toISOString()).toBe(new Date('2026-08-26T05:00:00+09:00').toISOString())
  })

  it('リセット時刻より前は前日の分がまだ続いている', () => {
    const { since, resetAt } = dailyRunWindow(runner(), jst('04:59'))
    expect(since.toISOString()).toBe(new Date('2026-08-24T05:00:00+09:00').toISOString())
    expect(resetAt.toISOString()).toBe(new Date('2026-08-25T05:00:00+09:00').toISOString())
  })

  it('タイムゾーンの指定に従う', () => {
    // 05:00 JST は 20:00 UTC(前日)なので、UTC 基準ではまだリセット前
    const { since } = dailyRunWindow(runner({ timezone: 'UTC' }), jst('05:00'))
    expect(since.toISOString()).toBe(new Date('2026-08-24T05:00:00Z').toISOString())
  })
})

describe('evaluateRunnerActivity', () => {
  it('上限が無制限なら件数を数えない', async () => {
    await expect(evaluateRunnerActivity(runner(), jst('14:00'))).resolves.toEqual({ active: true, reason: null })
    expect(agentRun.count).not.toHaveBeenCalled()
  })

  it('他の理由で稼働できない場合も件数を数えない', async () => {
    const target = runner({ enabled: false, dailyRunLimit: 5 })
    await expect(evaluateRunnerActivity(target, jst('14:00'))).resolves.toEqual({ active: false, reason: 'disabled' })
    expect(agentRun.count).not.toHaveBeenCalled()
  })

  it('上限に達していなければ稼働できる', async () => {
    agentRun.count.mockResolvedValue(2)
    const activity = await evaluateRunnerActivity(runner({ dailyRunLimit: 5 }), jst('14:00'))
    expect(activity.active).toBe(true)
    expect(activity.usage).toEqual({
      used: 2,
      limit: 5,
      resetAt: new Date('2026-08-26T05:00:00+09:00'),
    })
    expect(agentRun.count).toHaveBeenCalledWith({
      where: { runnerId: 'r1', startedAt: { gte: new Date('2026-08-25T05:00:00+09:00') } },
    })
  })

  it('上限に達していれば稼働できない', async () => {
    agentRun.count.mockResolvedValue(5)
    const activity = await evaluateRunnerActivity(runner({ dailyRunLimit: 5 }), jst('14:00'))
    expect(activity.active).toBe(false)
    expect(activity.reason).toBe('daily_limit')
    expect(activity.usage?.used).toBe(5)
  })

  it('予算が無制限ならコストを集計しない', async () => {
    await evaluateRunnerActivity(runner(), jst('14:00'))
    expect(agentUsage.aggregate).not.toHaveBeenCalled()
  })

  it('予算に達していなければ稼働でき、消化状況を返す', async () => {
    monthCost(9.99)
    const activity = await evaluateRunnerActivity(runner({ monthlyBudgetUsd: new Prisma.Decimal(10) }), jst('14:00'))
    expect(activity).toEqual({
      active: true,
      reason: null,
      budget: { usedUsd: 9.99, limitUsd: 10, resetAt: new Date('2026-09-01T05:00:00+09:00') },
    })
    expect(agentUsage.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { runnerId: 'r1', month: '2026-08' } }),
    )
  })

  it('予算に達していれば稼働できない', async () => {
    monthCost(10)
    const activity = await evaluateRunnerActivity(runner({ monthlyBudgetUsd: new Prisma.Decimal(10) }), jst('14:00'))
    expect(activity.active).toBe(false)
    expect(activity.reason).toBe('monthly_budget')
  })

  it('1日の上限で止まる場合は予算を集計しない', async () => {
    agentRun.count.mockResolvedValue(5)
    const target = runner({ dailyRunLimit: 5, monthlyBudgetUsd: new Prisma.Decimal(10) })
    expect((await evaluateRunnerActivity(target, jst('14:00'))).reason).toBe('daily_limit')
    expect(agentUsage.aggregate).not.toHaveBeenCalled()
  })
})

describe('pickAgentTasks', () => {
  const row = (override: Record<string, unknown> = {}) => ({
    id: 't1',
    number: 42,
    title: 'テストチケット',
    agentMode: 'plan',
    agentState: null,
    board: { key: 'ABC' },
    ...override,
  })

  it('未着手はモードに応じたアクションになる', async () => {
    ticket.findMany.mockResolvedValueOnce([row(), row({ id: 't2', number: 43, agentMode: 'auto' })] as never)

    expect(await pickAgentTasks(runner())).toEqual([
      { ticketId: 't1', displayId: 'ABC-42', title: 'テストチケット', mode: 'plan', action: 'plan', state: null },
      { ticketId: 't2', displayId: 'ABC-43', title: 'テストチケット', mode: 'auto', action: 'execute', state: null },
    ])
  })

  it('前の順番の兄弟を待っている子は拾わない', async () => {
    ticket.findMany.mockResolvedValueOnce([row(), row({ id: 't2', number: 43 })] as never)
    vi.mocked(findWaitingTicketIds).mockResolvedValueOnce(new Set(['t2']))

    const tasks = await pickAgentTasks(runner())
    expect(findWaitingTicketIds).toHaveBeenCalledWith(['t1', 't2'])
    expect(tasks.map((task) => task.ticketId)).toEqual(['t1'])
  })

  it('プラン投稿後に返信が来ていれば revise として拾う', async () => {
    ticket.findMany.mockResolvedValueOnce([row({ agentState: 'planned' })] as never)
    ticketComment.findFirst
      .mockResolvedValueOnce({ createdAt: new Date('2026-08-25T00:00:00Z') } as never)
      .mockResolvedValueOnce({ id: 'c2' } as never)

    const tasks = await pickAgentTasks(runner())
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ ticketId: 't1', action: 'revise', state: 'planned' })
  })

  it('プラン投稿後に返信が無ければ拾わない', async () => {
    ticket.findMany.mockResolvedValueOnce([row({ agentState: 'planned' })] as never)
    ticketComment.findFirst
      .mockResolvedValueOnce({ createdAt: new Date('2026-08-25T00:00:00Z') } as never)
      .mockResolvedValueOnce(null as never)

    expect(await pickAgentTasks(runner())).toEqual([])
  })

  it('返信が無くても、自動差し戻しのきっかけがそろっていれば revise として拾う', async () => {
    ticket.findMany.mockResolvedValueOnce([row({ agentState: 'planned' })] as never)
    ticketComment.findFirst
      .mockResolvedValueOnce({ createdAt: new Date('2026-08-25T00:00:00Z') } as never)
      .mockResolvedValueOnce(null as never)
    vi.mocked(hasSettledAutoRevise).mockResolvedValueOnce(true)

    expect(await pickAgentTasks(runner())).toMatchObject([{ ticketId: 't1', action: 'revise' }])
    expect(hasSettledAutoRevise).toHaveBeenCalledWith('t1')
  })

  it('担当とオプトインで絞り込む', async () => {
    ticket.findMany.mockResolvedValueOnce([] as never)
    await pickAgentTasks(runner())

    expect(ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ assigneeId: 'a1', agentMode: { not: null } }),
      }),
    )
  })

  it('アーカイブ済みのボードと、エージェントがメンバーでないボードは除く', async () => {
    ticket.findMany.mockResolvedValueOnce([] as never)
    await pickAgentTasks(runner())

    const where = ticket.findMany.mock.calls[0][0]?.where
    expect(where?.board).toEqual({
      archived: false,
      OR: [
        { members: { some: { userId: 'a1' } } },
        { groups: { some: { group: { userGroups: { some: { userId: 'a1' } } } } } },
      ],
    })
  })
})

describe('failStaleAgentRuns', () => {
  const staleRun = () => ({
    id: 'run1',
    ticketId: 't1',
    action: 'execute',
    startedAt: new Date('2026-08-25T00:00:00Z'),
    ticket: notifyTicket(),
    runner: { user: { name: 'テストエージェント' } },
  })

  it('時間切れが無ければ何もしない', async () => {
    agentRun.findMany.mockResolvedValueOnce([] as never)

    expect(await failStaleAgentRuns('r1')).toBe(0)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('時間切れの実行を失敗にし、処理中のチケットも解除する', async () => {
    agentRun.findMany.mockResolvedValueOnce([staleRun()] as never)

    expect(await failStaleAgentRuns('r1')).toBe(1)
    expect(prisma.$transaction).toHaveBeenCalled()
    expect(ticket.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['t1'] }, agentState: 'running' },
      data: { agentState: 'failed' },
    })
  })

  it('時間切れは失敗として通知する', async () => {
    agentRun.findMany.mockResolvedValueOnce([staleRun()] as never)

    await failStaleAgentRuns('r1')

    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run1',
        ticket: expect.objectContaining({ displayId: 'ABC-42' }),
        status: 'failed',
        state: 'failed',
        summary: 'timeout',
      }),
      // 実行を閉じるのと同じトランザクションで投入する
      expect.anything(),
    )
  })

  it('チケットが削除済みの実行は通知しない(宛先のボードを辿れない)', async () => {
    agentRun.findMany.mockResolvedValueOnce([{ ...staleRun(), ticketId: null, ticket: null }] as never)

    expect(await failStaleAgentRuns('r1')).toBe(1)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('読み出しから更新までの間に閉じられた実行は通知せず件数にも数えない', async () => {
    agentRun.findMany.mockResolvedValueOnce([staleRun()] as never)
    agentRun.updateMany.mockResolvedValueOnce({ count: 0 } as never)

    expect(await failStaleAgentRuns('r1')).toBe(0)
    expect(agentRun.updateMany, 'クローズ権は status: running の条件付き更新で取る').toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'run1', status: 'running' } }),
    )
    expect(ticket.updateMany, '掴めていないので相手が確定させたチケットの状態も触らない').not.toHaveBeenCalled()
    expect(notifyMock, '閉じたのは別の経路なので通知もそちらが出している').not.toHaveBeenCalled()
  })

  it('掴めた実行だけを通知する', async () => {
    agentRun.findMany.mockResolvedValueOnce([staleRun(), { ...staleRun(), id: 'run2', ticketId: 't2' }] as never)
    agentRun.updateMany.mockResolvedValueOnce({ count: 0 } as never).mockResolvedValueOnce({ count: 1 } as never)

    expect(await failStaleAgentRuns('r1')).toBe(1)
    expect(ticket.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['t2'] }, agentState: 'running' },
      data: { agentState: 'failed' },
    })
    expect(notifyMock).toHaveBeenCalledTimes(1)
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run2' }), expect.anything())
  })
})

describe('resolveAgentTask', () => {
  const row = (override: Record<string, unknown> = {}) => ({
    id: 't1',
    number: 42,
    title: 'テストチケット',
    status: 'todo',
    assigneeId: 'a1',
    agentMode: 'plan',
    agentState: null,
    board: { key: 'ABC' },
    ...override,
  })

  it('処理中のチケットは開始時のアクションのまま返す(待ち行列には載らない)', async () => {
    ticket.findFirst.mockResolvedValueOnce(row({ agentState: 'running' }) as never)
    agentRun.findFirst.mockResolvedValueOnce({ action: 'revise' } as never)

    expect(await resolveAgentTask(runner(), 't1')).toMatchObject({ action: 'revise', state: 'running' })
  })

  it('処理してよい条件(担当・オプトイン・未完了・ボード)を満たさなければ対象外', async () => {
    ticket.findFirst.mockResolvedValueOnce(null as never)

    expect(await resolveAgentTask(runner(), 't1')).toBeNull()
    expect(ticket.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 't1', assigneeId: 'a1' }) }),
    )
  })

  it('返信待ちのチケットは対象外', async () => {
    ticket.findFirst.mockResolvedValueOnce(row({ agentState: 'planned' }) as never)
    ticketComment.findFirst.mockResolvedValueOnce(null as never)

    expect(await resolveAgentTask(runner(), 't1')).toBeNull()
  })
})

describe('finishAgentRunById', () => {
  const openRun = () => ({
    id: 'run1',
    runnerId: 'r1',
    status: 'running',
    ticketId: 't1',
    action: 'execute',
    startedAt: new Date('2026-08-25T00:00:00Z'),
    ticket: notifyTicket(),
    runner: { user: { name: 'テストエージェント' } },
  })

  it('他のランナーの実行は閉じられない', async () => {
    agentRun.findUnique.mockResolvedValueOnce({ id: 'run1', runnerId: 'other', status: 'running' } as never)

    expect(await finishAgentRunById(runner(), 'run1', 'failed')).toBe(false)
  })

  it('報告が無いまま成功と伝えられた実行は失敗として閉じる', async () => {
    agentRun.findUnique.mockResolvedValueOnce(openRun() as never)

    expect(await finishAgentRunById(runner(), 'run1', 'succeeded', 'exit 0')).toBe(true)
    expect(agentRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run1', status: 'running' },
      data: { status: 'failed', summary: 'exit 0', finishedAt: expect.any(Date) },
    })
    expect(ticket.updateMany).toHaveBeenCalledWith({
      where: { id: 't1', agentState: 'running' },
      data: { agentState: 'failed' },
    })
    expect(notifyMock, '閉じたのはこの経路なので通知もここから出す').toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run1', status: 'failed', state: 'failed', summary: 'exit 0' }),
      expect.anything(),
    )
  })

  it('報告済みの実行は上書きしない', async () => {
    agentRun.findUnique.mockResolvedValueOnce({ ...openRun(), status: 'succeeded' } as never)
    agentRun.updateMany.mockResolvedValueOnce({ count: 0 } as never)

    expect(await finishAgentRunById(runner(), 'run1', 'failed')).toBe(true)
    expect(agentRun.updateMany, '条件に status: running が入るので確定済みの行には当たらない').toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'run1', status: 'running' } }),
    )
    expect(notifyMock, '報告時に finishAgentTask が通知済みなので二重に送らない').not.toHaveBeenCalled()
  })

  it('報告と同時に走っても、閉じられなかった側は通知しない', async () => {
    // 報告(finishAgentTask)のコミット前に読み出すと status は running に見える。
    // それでも更新が当たらなければ、閉じたのは向こうなので通知は出さない
    agentRun.findUnique.mockResolvedValueOnce(openRun() as never)
    agentRun.updateMany.mockResolvedValueOnce({ count: 0 } as never)

    expect(await finishAgentRunById(runner(), 'run1', 'succeeded', 'exit 0')).toBe(true)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('報告済みの実行にも計測値は書き込み、月の集計へ加算する', async () => {
    agentRun.findUnique.mockResolvedValueOnce({ ...openRun(), status: 'succeeded' } as never)
    // 1回目は実行を閉じる更新(報告済みなので当たらない)、2回目は計測値の書き込み
    agentRun.updateMany.mockResolvedValueOnce({ count: 0 } as never).mockResolvedValueOnce({ count: 1 } as never)
    agentUsage.findFirst.mockResolvedValueOnce(null as never)

    const metrics = { model: 'opus', inputTokens: 100, outputTokens: 10, costUsd: 0.1, exitCode: 0 }
    expect(await finishAgentRunById(runner(), 'run1', 'succeeded', 'done', metrics)).toBe(true)

    expect(agentRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run1', measuredAt: null },
      data: { ...metrics, measuredAt: expect.any(Date) },
    })
    expect(agentUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ runnerId: 'r1', boardId: 'b1', costUsd: 0.1 }) }),
    )
    expect(notifyMock).not.toHaveBeenCalled()
  })
})

describe('startAgentRun', () => {
  const openTicket = (override: Record<string, unknown> = {}) => ({
    id: 't1',
    number: 42,
    title: 'テストチケット',
    status: 'todo',
    assigneeId: 'a1',
    agentMode: 'plan',
    agentState: null,
    board: { key: 'ABC' },
    ...override,
  })

  it('処理してよい条件を満たさないチケットは開始できない', async () => {
    ticket.findFirst.mockResolvedValueOnce(null as never)

    expect(await startAgentRun(runner(), 't1', 'plan')).toEqual({ ok: false, reason: 'ticket_not_available' })
    expect(agentRun.create).not.toHaveBeenCalled()
  })

  it('実行を記録してチケットを処理中にする', async () => {
    ticket.findFirst.mockResolvedValueOnce(openTicket() as never)
    agentRun.create.mockResolvedValueOnce({ id: 'run1' } as never)

    expect(await startAgentRun(runner(), 't1', 'plan')).toEqual({
      ok: true,
      run: { id: 'run1', displayId: 'ABC-42' },
    })
    expect(agentRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { runnerId: 'r1', ticketId: 't1', ticketRef: 'ABC-42', action: 'plan' },
      }),
    )
    expect(ticket.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { agentState: 'running' } })
    // 未消化の自動差し戻しのきっかけは、この実行で引き受ける
    expect(consumeAutoReviseTriggers).toHaveBeenCalledWith(expect.anything(), 't1', 'run1')
  })

  it('待ち行列を作った後に自動差し戻しのきっかけが届いていたら、開始せず次の回へ回す', async () => {
    ticket.findFirst.mockResolvedValueOnce(openTicket() as never)
    vi.mocked(hasUnsettledAutoRevise).mockResolvedValueOnce(true)

    expect(await startAgentRun(runner(), 't1', 'revise')).toEqual({ ok: false, reason: 'ticket_not_available' })
    expect(agentRun.create).not.toHaveBeenCalled()
    expect(consumeAutoReviseTriggers).not.toHaveBeenCalled()
  })

  it('上限が無制限なら件数を数えずに開始する', async () => {
    ticket.findFirst.mockResolvedValueOnce(openTicket() as never)
    agentRun.create.mockResolvedValueOnce({ id: 'run1' } as never)

    expect(await startAgentRun(runner({ dailyRunLimit: 0 }), 't1', 'plan')).toEqual({
      ok: true,
      run: { id: 'run1', displayId: 'ABC-42' },
    })
    expect(agentRun.count).not.toHaveBeenCalled()
  })

  it('上限に達していれば実行を作成しない(チェックと作成を同一トランザクションで行う)', async () => {
    ticket.findFirst.mockResolvedValueOnce(openTicket() as never)
    agentRun.count.mockResolvedValueOnce(5)

    const result = await startAgentRun(runner({ dailyRunLimit: 5 }), 't1', 'plan', jst('14:00'))

    expect(result).toEqual({
      ok: false,
      reason: 'daily_limit',
      usage: { used: 5, limit: 5, resetAt: new Date('2026-08-26T05:00:00+09:00') },
    })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(agentRun.create).not.toHaveBeenCalled()
    expect(ticket.update).not.toHaveBeenCalled()
  })

  it('予算に達していれば実行を作成しない', async () => {
    ticket.findFirst.mockResolvedValueOnce(openTicket() as never)
    monthCost(10)

    const result = await startAgentRun(runner({ monthlyBudgetUsd: new Prisma.Decimal(10) }), 't1', 'plan', jst('14:00'))

    expect(result).toEqual({
      ok: false,
      reason: 'monthly_budget',
      budget: { usedUsd: 10, limitUsd: 10, resetAt: new Date('2026-09-01T05:00:00+09:00') },
    })
    expect(prisma.$queryRaw, '並行した開始が揃ってすり抜けないようランナーをロックする').toHaveBeenCalled()
    expect(agentRun.create).not.toHaveBeenCalled()
  })

  it('上限未達なら件数を数えたうえで実行を作成する', async () => {
    ticket.findFirst.mockResolvedValueOnce(openTicket() as never)
    agentRun.count.mockResolvedValueOnce(4)
    agentRun.create.mockResolvedValueOnce({ id: 'run1' } as never)

    const result = await startAgentRun(runner({ dailyRunLimit: 5 }), 't1', 'plan', jst('14:00'))

    expect(result).toEqual({ ok: true, run: { id: 'run1', displayId: 'ABC-42' } })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(agentRun.count.mock.invocationCallOrder[0]).toBeLessThan(agentRun.create.mock.invocationCallOrder[0])
  })
})

describe('finishAgentTask', () => {
  it.each([
    ['planned', 'planned', 'succeeded'],
    ['completed', 'done', 'succeeded'],
    ['skipped', 'skipped', 'skipped'],
    ['failed', 'failed', 'failed'],
  ] as const)('%s はチケットを %s、実行を %s にする', async (outcome, state, runStatus) => {
    ticket.update.mockResolvedValueOnce(notifyTicket() as never)
    agentRun.findFirst.mockResolvedValueOnce({ id: 'run1', action: 'execute' } as never)

    expect(await finishAgentTask(runner(), 't1', outcome, '要約')).toEqual({ state })
    expect(ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' }, data: { agentState: state } }),
    )
    expect(agentRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run1', status: 'running' },
        data: expect.objectContaining({ status: runStatus, summary: '要約', action: undefined }),
      }),
    )
    expect(notifyMock, '通知の文面で次にすることを示すため、実行後の状態を渡す').toHaveBeenCalledWith(
      expect.objectContaining({ status: runStatus, state }),
      expect.anything(),
    )
  })

  it('revise で開始した実行は完了報告なら execute へ確定する', async () => {
    agentRun.findFirst.mockResolvedValueOnce({ id: 'run1', action: 'revise' } as never)

    await finishAgentTask(runner(), 't1', 'completed')

    expect(agentRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'execute' }) }),
    )
  })

  it.each([
    ['revise', 'planned'],
    ['plan', 'completed'],
  ] as const)('%s で開始し %s を報告した実行はアクションを書き換えない', async (action, outcome) => {
    agentRun.findFirst.mockResolvedValueOnce({ id: 'run1', action } as never)

    await finishAgentTask(runner(), 't1', outcome)

    expect(agentRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: undefined }) }),
    )
  })

  it('自動運用の設定が無い場合は状態だけ更新する', async () => {
    expect(await finishAgentTask(null, 't1', 'completed')).toEqual({ state: 'done' })
    expect(agentRun.findFirst).not.toHaveBeenCalled()
    expect(agentRun.updateMany).not.toHaveBeenCalled()
  })

  it('先に閉じられた実行は状態を巻き戻さず通知もしない', async () => {
    // 時間切れ(failStaleAgentRuns)が先に failed で閉じた直後に報告が届いたケース
    agentRun.findFirst.mockResolvedValueOnce({ id: 'run1', action: 'execute' } as never)
    agentRun.updateMany.mockResolvedValueOnce({ count: 0 } as never)
    ticket.findUnique.mockResolvedValueOnce({ agentState: 'failed' } as never)

    expect(await finishAgentTask(runner(), 't1', 'completed'), '確定済みの状態をそのまま返す').toEqual({
      state: 'failed',
    })
    expect(ticket.update, '報告どおりの done へ巻き戻さない').not.toHaveBeenCalled()
    expect(notifyMock, '通知は閉じた側が出している').not.toHaveBeenCalled()
  })

  const criteria = [{ id: 'c1', met: true, evidence: 'テストが通った' }]

  it('受け入れ条件の自己申告を、実行を閉じるのと同じトランザクションで記録する', async () => {
    ticket.update.mockResolvedValueOnce(notifyTicket() as never)
    agentRun.findFirst.mockResolvedValueOnce({ id: 'run1', action: 'execute' } as never)
    ticketCriterion.count.mockResolvedValueOnce(1)

    await finishAgentTask(runner(), 't1', 'completed', null, criteria)

    expect(ticketCriterion.count).toHaveBeenCalledWith({ where: { ticketId: 't1', id: { in: ['c1'] } } })
    expect(ticketCriterion.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { agentMet: true, agentEvidence: 'テストが通った', agentReportedAt: expect.any(Date) },
    })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('自動運用の設定が無い場合も自己申告は記録する', async () => {
    ticketCriterion.count.mockResolvedValueOnce(1)

    await finishAgentTask(null, 't1', 'completed', null, criteria)

    expect(ticketCriterion.update).toHaveBeenCalledTimes(1)
  })

  it('先に閉じられた実行の自己申告は記録しない(失敗した実行が充足に見えないように)', async () => {
    agentRun.findFirst.mockResolvedValueOnce({ id: 'run1', action: 'execute' } as never)
    agentRun.updateMany.mockResolvedValueOnce({ count: 0 } as never)
    ticket.findUnique.mockResolvedValueOnce({ agentState: 'failed' } as never)
    ticketCriterion.count.mockResolvedValueOnce(1)

    await finishAgentTask(runner(), 't1', 'completed', null, criteria)

    expect(ticketCriterion.update).not.toHaveBeenCalled()
  })

  it('そのチケットに無い項目が混ざっていたら、実行を閉じずにエラーにする', async () => {
    ticketCriterion.count.mockResolvedValueOnce(1)

    await expect(
      finishAgentTask(runner(), 't1', 'completed', null, [...criteria, { id: 'other', met: true, evidence: 'x' }]),
    ).rejects.toBeInstanceOf(ClientError)
    expect(agentRun.updateMany).not.toHaveBeenCalled()
    expect(ticket.update).not.toHaveBeenCalled()
    expect(ticketCriterion.update).not.toHaveBeenCalled()
  })
})
