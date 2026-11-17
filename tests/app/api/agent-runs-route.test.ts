/**
 * ランナー向けの実行 API(/api/agent/runs・/api/agent/status)のルートハンドラ
 *
 * 認証・実行の記録そのものは差し替え、稼働条件との関係(取得・停止・時間切れの回収は稼働条件に関係なく使える、
 * 再送の照合は稼働条件より先)と、応答のステータスを確かめる。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateRunner: vi.fn(),
  evaluateRunner: vi.fn(),
  evaluateRunnerActivity: vi.fn(),
  startAgentRun: vi.fn(),
  findRequestedAgentRun: vi.fn(),
  cancelAgentRun: vi.fn(),
  failStaleAgentRuns: vi.fn(),
  finishAgentRunById: vi.fn(),
  listRunnerAgentRuns: vi.fn(),
  findRunnerAgentRun: vi.fn(),
  pickAgentTasks: vi.fn(),
}))

vi.mock('@/lib/agent/agent-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agent/agent-api')>()),
  authenticateRunner: mocks.authenticateRunner,
}))
vi.mock('@/lib/agent/agent-activity', () => ({
  evaluateRunner: mocks.evaluateRunner,
  evaluateRunnerActivity: mocks.evaluateRunnerActivity,
  activeWindowLabel: () => null,
}))
vi.mock('@/lib/agent/agent-run', () => ({
  CANCELED_SUMMARY: 'canceled',
  startAgentRun: mocks.startAgentRun,
  findRequestedAgentRun: mocks.findRequestedAgentRun,
  cancelAgentRun: mocks.cancelAgentRun,
  failStaleAgentRuns: mocks.failStaleAgentRuns,
  finishAgentRunById: mocks.finishAgentRunById,
}))
vi.mock('@/lib/agent/agent-run-recovery', () => ({
  AGENT_RUN_LIST_MAX_LIMIT: 100,
  listRunnerAgentRuns: mocks.listRunnerAgentRuns,
  findRunnerAgentRun: mocks.findRunnerAgentRun,
}))
vi.mock('@/lib/agent/agent-task', () => ({ pickAgentTasks: mocks.pickAgentTasks }))
vi.mock('@/lib/prisma', async () => (await import('../../helpers/prisma')).mockPrisma({ agentRunner: ['update'] }))

const runsRoute = await import('@/app/api/agent/runs/route')
const runRoute = await import('@/app/api/agent/runs/[id]/route')
const cancelRoute = await import('@/app/api/agent/runs/[id]/cancel/route')
const statusRoute = await import('@/app/api/agent/status/route')

const TICKET_ID = '01a0dd3b-e65b-71aa-bec7-3412abca25f7'
const runner = { id: 'r1', userId: 'a1' }
const auth = { user: { id: 'a1', name: 'エージェント', email: 'agent@example.com' } }

const post = (path: string, body?: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const get = (path: string) => new Request(`http://localhost${path}`)
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authenticateRunner.mockResolvedValue({ ok: true, ctx: { auth, runner } })
  mocks.evaluateRunner.mockReturnValue({ active: true, reason: null })
  mocks.evaluateRunnerActivity.mockResolvedValue({ active: false, reason: 'outside_hours' })
  mocks.findRequestedAgentRun.mockResolvedValue(null)
})

describe('POST /api/agent/runs', () => {
  it('同じ requestId の再送は、稼働時間外でも既存の実行を返す', async () => {
    mocks.evaluateRunner.mockReturnValue({ active: false, reason: 'outside_hours' })
    mocks.findRequestedAgentRun.mockResolvedValue({
      ok: true,
      run: { id: 'run1', displayId: 'ABC-42', status: 'running' },
    })

    const response = await runsRoute.POST(
      post('/api/agent/runs', { ticketId: TICKET_ID, action: 'plan', requestId: 'req-1' }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ runId: 'run1', displayId: 'ABC-42', status: 'running' })
    expect(mocks.findRequestedAgentRun).toHaveBeenCalledWith('r1', 'req-1', TICKET_ID)
    expect(mocks.startAgentRun).not.toHaveBeenCalled()
  })

  it('初回の開始は requestId を渡して記録する', async () => {
    mocks.startAgentRun.mockResolvedValue({ ok: true, run: { id: 'run1', displayId: 'ABC-42', status: 'running' } })

    const response = await runsRoute.POST(
      post('/api/agent/runs', { ticketId: TICKET_ID, action: 'plan', requestId: 'req-1' }),
    )

    expect(response.status).toBe(200)
    expect(mocks.startAgentRun).toHaveBeenCalledWith(runner, TICKET_ID, 'plan', 'req-1')
  })

  it('稼働時間外の新しい開始は 409', async () => {
    mocks.evaluateRunner.mockReturnValue({ active: false, reason: 'outside_hours' })

    const response = await runsRoute.POST(post('/api/agent/runs', { ticketId: TICKET_ID, action: 'plan' }))

    expect(response.status).toBe(409)
    expect(mocks.startAgentRun).not.toHaveBeenCalled()
  })
})

describe('GET /api/agent/runs', () => {
  it('自分のランナーの実行を、条件で絞って返す', async () => {
    mocks.listRunnerAgentRuns.mockResolvedValue([{ id: 'run1' }])

    const response = await runsRoute.GET(get('/api/agent/runs?status=running&requestId=req-1&limit=5'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ runs: [{ id: 'run1' }] })
    expect(mocks.listRunnerAgentRuns).toHaveBeenCalledWith('r1', { status: 'running', requestId: 'req-1', limit: 5 })
  })

  it('不正な条件は 400', async () => {
    const response = await runsRoute.GET(get('/api/agent/runs?status=unknown'))
    expect(response.status).toBe(400)
  })
})

describe('GET /api/agent/runs/:id', () => {
  it('他のランナーの実行は 404', async () => {
    mocks.findRunnerAgentRun.mockResolvedValue(null)

    const response = await runRoute.GET(get('/api/agent/runs/run9'), params('run9'))

    expect(response.status).toBe(404)
    expect(mocks.findRunnerAgentRun).toHaveBeenCalledWith('r1', 'run9')
  })

  it('自分の実行の ID・状態・対象チケットを返す', async () => {
    const run = { id: 'run1', status: 'running', ticketId: TICKET_ID, ticketRef: 'ABC-42' }
    mocks.findRunnerAgentRun.mockResolvedValue(run)

    const response = await runRoute.GET(get('/api/agent/runs/run1'), params('run1'))

    expect(await response.json()).toEqual(run)
  })
})

describe('POST /api/agent/runs/:id/cancel', () => {
  it.each([
    ['canceled', 200],
    ['not_running', 409],
    ['not_found', 404],
  ])('%s は %s を返す', async (result, status) => {
    mocks.cancelAgentRun.mockResolvedValue(result)

    const response = await cancelRoute.POST(post('/api/agent/runs/run1/cancel'), params('run1'))

    expect(response.status).toBe(status)
    expect(mocks.cancelAgentRun).toHaveBeenCalledWith({ runId: 'run1', runnerId: 'r1' })
  })
})

describe('POST /api/agent/status', () => {
  it('稼働時間外でも時間切れの実行を回収し、作業は渡さない', async () => {
    const response = await statusRoute.POST(post('/api/agent/status', {}))

    expect(mocks.failStaleAgentRuns).toHaveBeenCalledWith('r1', expect.any(Date))
    expect((await response.json()).tasks).toEqual([])
    expect(mocks.pickAgentTasks).not.toHaveBeenCalled()
  })
})
