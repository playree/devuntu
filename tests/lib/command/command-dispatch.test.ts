/**
 * 実行の 1 tick の単体テスト
 *
 * 回収 → 中断 → 空き枠ぶんの取り出し → 起動、の順と、定義が消えた実行の閉じ方を固定する。
 * 実行の完走を待たないことも見る。
 */

import type { CommandDef, CommandTarget } from '@/lib/command/command'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  env: { COMMAND_EXEC_ENABLED: true, COMMAND_MAX_CONCURRENT: 2 },
  findCommandDef: vi.fn(),
  findCommandTarget: vi.fn(),
  applyCancel: vi.fn(),
  executeCommandRun: vi.fn(),
  appendSystemMessage: vi.fn(),
  runningCount: vi.fn(() => 0),
  claimQueuedRuns: vi.fn(),
  finishCommandRun: vi.fn(),
  listCancelRequestedRuns: vi.fn(),
  reclaimStaleRuns: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/env-util', () => ({ envu: { server: mocks.env } }))
vi.mock('@/lib/logger', () => ({ logger: mocks.logger }))
vi.mock('@/lib/command/command-catalog', () => ({
  findCommandDef: mocks.findCommandDef,
  findCommandTarget: mocks.findCommandTarget,
}))
vi.mock('@/lib/command/command-exec', () => ({
  applyCancel: mocks.applyCancel,
  executeCommandRun: mocks.executeCommandRun,
}))
vi.mock('@/lib/command/command-log', () => ({ appendSystemMessage: mocks.appendSystemMessage }))
vi.mock('@/lib/command/command-registry', () => ({ runningCount: mocks.runningCount }))
vi.mock('@/lib/command/command-run', () => ({
  claimQueuedRuns: mocks.claimQueuedRuns,
  finishCommandRun: mocks.finishCommandRun,
  listCancelRequestedRuns: mocks.listCancelRequestedRuns,
  reclaimStaleRuns: mocks.reclaimStaleRuns,
}))

const { WORKER_ID, runCommandDispatch } = await import('@/lib/command/command-dispatch')

const NOW = new Date('2026-01-01T00:00:00Z')

const def = { id: 'deploy-web', targetId: 'web01' } as CommandDef
const target = { id: 'web01' } as CommandTarget

beforeEach(() => {
  vi.clearAllMocks()
  mocks.env.COMMAND_EXEC_ENABLED = true
  mocks.env.COMMAND_MAX_CONCURRENT = 2
  mocks.runningCount.mockReturnValue(0)
  mocks.listCancelRequestedRuns.mockResolvedValue([])
  mocks.claimQueuedRuns.mockResolvedValue([])
  mocks.findCommandDef.mockReturnValue(def)
  mocks.findCommandTarget.mockReturnValue(target)
  mocks.executeCommandRun.mockResolvedValue(undefined)
})

describe('WORKER_ID', () => {
  it('プロセスIDを先頭に持つ', () => {
    expect(WORKER_ID.startsWith(`${process.pid}-`)).toBe(true)
  })
})

describe('runCommandDispatch', () => {
  it('リモート実行が無効なら DB を触らない', async () => {
    mocks.env.COMMAND_EXEC_ENABLED = false

    await runCommandDispatch(NOW)

    expect(mocks.reclaimStaleRuns).not.toHaveBeenCalled()
    expect(mocks.listCancelRequestedRuns).not.toHaveBeenCalled()
    expect(mocks.claimQueuedRuns).not.toHaveBeenCalled()
  })

  it('stale の回収は渡した時刻で行う', async () => {
    await runCommandDispatch(NOW)

    expect(mocks.reclaimStaleRuns).toHaveBeenCalledWith(NOW)
  })

  it('自分が掴んでいる中断要求をすべて適用する', async () => {
    mocks.listCancelRequestedRuns.mockResolvedValue(['run-1', 'run-2'])

    await runCommandDispatch(NOW)

    expect(mocks.listCancelRequestedRuns).toHaveBeenCalledWith(WORKER_ID)
    expect(mocks.applyCancel.mock.calls).toEqual([['run-1'], ['run-2']])
  })

  it('回収・中断を取り出しより先に行う', async () => {
    const order: string[] = []
    mocks.reclaimStaleRuns.mockImplementation(async () => {
      order.push('reclaim')
    })
    mocks.listCancelRequestedRuns.mockImplementation(async () => {
      order.push('cancel')
      return []
    })
    mocks.claimQueuedRuns.mockImplementation(async () => {
      order.push('claim')
      return []
    })

    await runCommandDispatch(NOW)

    expect(order).toEqual(['reclaim', 'cancel', 'claim'])
  })

  it('同時実行数の上限から実行中の件数を引いた分だけ取り出す', async () => {
    mocks.env.COMMAND_MAX_CONCURRENT = 3
    mocks.runningCount.mockReturnValue(1)

    await runCommandDispatch(NOW)

    expect(mocks.claimQueuedRuns).toHaveBeenCalledWith(2, WORKER_ID)
  })

  it.each([
    ['上限ちょうど', 2],
    ['上限超過', 3],
  ])('空き枠が無ければ(%s)取り出さないが、中断は適用する', async (_, running) => {
    mocks.runningCount.mockReturnValue(running)
    mocks.listCancelRequestedRuns.mockResolvedValue(['run-1'])

    await runCommandDispatch(NOW)

    expect(mocks.claimQueuedRuns).not.toHaveBeenCalled()
    expect(mocks.applyCancel).toHaveBeenCalledWith('run-1')
  })

  it('取り出した実行を定義・対象・パラメータ付きで起動する', async () => {
    mocks.claimQueuedRuns.mockResolvedValue([{ id: 'run-1', commandKey: 'deploy-web', params: { tag: 'v1' } }])

    await runCommandDispatch(NOW)

    expect(mocks.findCommandTarget).toHaveBeenCalledWith('web01')
    expect(mocks.executeCommandRun).toHaveBeenCalledWith({
      runId: 'run-1',
      workerId: WORKER_ID,
      def,
      target,
      params: { tag: 'v1' },
    })
  })

  it('パラメータが null なら空オブジェクトで起動する', async () => {
    mocks.claimQueuedRuns.mockResolvedValue([{ id: 'run-1', commandKey: 'deploy-web', params: null }])

    await runCommandDispatch(NOW)

    expect(mocks.executeCommandRun).toHaveBeenCalledWith(expect.objectContaining({ params: {} }))
  })

  it('実行の完走を待たずに返る', async () => {
    mocks.claimQueuedRuns.mockResolvedValue([{ id: 'run-1', commandKey: 'deploy-web', params: {} }])
    mocks.executeCommandRun.mockReturnValue(new Promise(() => {}))

    await expect(runCommandDispatch(NOW)).resolves.toBeUndefined()
  })

  it('実行が例外で落ちてもログに残すだけで、後続の実行も起動する', async () => {
    const error = new Error('crash')
    mocks.claimQueuedRuns.mockResolvedValue([
      { id: 'run-1', commandKey: 'deploy-web', params: {} },
      { id: 'run-2', commandKey: 'deploy-web', params: {} },
    ])
    mocks.executeCommandRun.mockRejectedValueOnce(error)

    await runCommandDispatch(NOW)
    await vi.waitFor(() => {
      expect(mocks.logger.error).toHaveBeenCalledWith({ error, runId: 'run-1' }, 'command run crashed')
    })

    expect(mocks.executeCommandRun).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['定義が消えた', () => mocks.findCommandDef.mockReturnValue(null)],
    ['対象が消えた', () => mocks.findCommandTarget.mockReturnValue(null)],
  ])('%s実行は起動せず、起動失敗として閉じる', async (_, arrange) => {
    arrange()
    mocks.claimQueuedRuns.mockResolvedValue([{ id: 'run-1', commandKey: 'deploy-web', params: {} }])

    await runCommandDispatch(NOW)

    expect(mocks.executeCommandRun).not.toHaveBeenCalled()
    expect(mocks.appendSystemMessage).toHaveBeenCalledWith('run-1', 'command_sys_def_missing')
    expect(mocks.finishCommandRun).toHaveBeenCalledWith({
      runId: 'run-1',
      workerId: WORKER_ID,
      status: 'failed',
      exitCode: null,
      failureKind: 'start_failed',
    })
  })

  it('定義が消えた実行があっても、残りの実行は起動する', async () => {
    mocks.findCommandDef.mockImplementation((key: string) => (key === 'gone' ? null : def))
    mocks.claimQueuedRuns.mockResolvedValue([
      { id: 'run-1', commandKey: 'gone', params: {} },
      { id: 'run-2', commandKey: 'deploy-web', params: {} },
    ])

    await runCommandDispatch(NOW)

    expect(mocks.finishCommandRun).toHaveBeenCalledTimes(1)
    expect(mocks.executeCommandRun).toHaveBeenCalledTimes(1)
    expect(mocks.executeCommandRun).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-2' }))
  })
})
