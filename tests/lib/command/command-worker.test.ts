/**
 * リモート実行ワーカーの起動と駆動の単体テスト
 *
 * 1 tick の中身は差し替え、有効化の条件・タイマー・終了シグナル・ドレインの判定を見る。
 * `started` はモジュール変数なので、テストごとにモジュールを読み直す。
 */

import { COMMAND_START_DELAY_MS, COMMAND_TICK_MS } from '@/lib/command/command'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runCommandDispatch: vi.fn<() => Promise<void>>(),
  runningCount: vi.fn(() => 0),
  abortAllRuns: vi.fn(),
  env: { COMMAND_EXEC_ENABLED: true, COMMAND_WORKER_ENABLED: true },
  after: vi.fn(),
  isMaintenanceMode: vi.fn(() => false),
  registerMaintenanceDrainSource: vi.fn(),
}))

vi.mock('@/lib/command/command-dispatch', () => ({ runCommandDispatch: () => mocks.runCommandDispatch() }))
vi.mock('@/lib/command/command-registry', () => ({
  runningCount: mocks.runningCount,
  abortAllRuns: mocks.abortAllRuns,
}))
vi.mock('@/lib/env-util', () => ({ envu: { server: mocks.env } }))
vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@/lib/maintenance/maintenance-mode', () => ({
  isMaintenanceMode: mocks.isMaintenanceMode,
  registerMaintenanceDrainSource: mocks.registerMaintenanceDrainSource,
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

/** モジュール変数(`started`)を持ち越さないよう読み直す */
const loadWorker = async () => {
  vi.resetModules()
  return await import('@/lib/command/command-worker')
}

/** 本物のシグナルハンドラを張らないよう差し替える */
const processOnce = vi.spyOn(process, 'once').mockImplementation(() => process)

/** 登録された終了シグナルのハンドラ */
const signalHandler = (signal: string): (() => void) => {
  const call = processOnce.mock.calls.find(([name]) => name === signal)
  if (!call) {
    throw new Error(`${signal} handler not registered`)
  }
  return call[1] as () => void
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  mocks.env.COMMAND_EXEC_ENABLED = true
  mocks.env.COMMAND_WORKER_ENABLED = true
  mocks.runningCount.mockReturnValue(0)
  mocks.isMaintenanceMode.mockReturnValue(false)
  mocks.runCommandDispatch.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

afterAll(() => {
  processOnce.mockRestore()
})

describe('startCommandWorker', () => {
  it.each([
    ['リモート実行が無効', { COMMAND_EXEC_ENABLED: false, COMMAND_WORKER_ENABLED: true }],
    ['ワーカーが無効', { COMMAND_EXEC_ENABLED: true, COMMAND_WORKER_ENABLED: false }],
  ])('%sならタイマーもシグナルハンドラも張らない', async (_, env) => {
    Object.assign(mocks.env, env)
    const { startCommandWorker } = await loadWorker()

    startCommandWorker()
    await vi.advanceTimersByTimeAsync(COMMAND_START_DELAY_MS + COMMAND_TICK_MS * 2)

    expect(mocks.runCommandDispatch).not.toHaveBeenCalled()
    expect(processOnce).not.toHaveBeenCalled()
  })

  it('初回の遅延までは回らず、その後から間隔ごとに回る', async () => {
    const { startCommandWorker } = await loadWorker()

    startCommandWorker()
    await vi.advanceTimersByTimeAsync(COMMAND_START_DELAY_MS - 1)
    expect(mocks.runCommandDispatch).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.runCommandDispatch).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(COMMAND_TICK_MS - 1)
    expect(mocks.runCommandDispatch).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.runCommandDispatch).toHaveBeenCalledTimes(2)
  })

  it('1 tick が失敗しても次の周は動く', async () => {
    mocks.runCommandDispatch.mockRejectedValueOnce(new Error('boom'))
    const { startCommandWorker } = await loadWorker()

    startCommandWorker()
    await vi.advanceTimersByTimeAsync(COMMAND_START_DELAY_MS + COMMAND_TICK_MS)

    expect(mocks.runCommandDispatch).toHaveBeenCalledTimes(2)
  })

  it('2度呼んでもシグナルハンドラは 1 組だけ', async () => {
    const { startCommandWorker } = await loadWorker()

    startCommandWorker()
    startCommandWorker()

    expect(processOnce).toHaveBeenCalledTimes(2)
    expect(processOnce.mock.calls.map(([name]) => name)).toEqual(['SIGTERM', 'SIGINT'])
  })

  it.each(['SIGTERM', 'SIGINT'])('%s で実行中の子プロセスを中断扱いで止める', async (signal) => {
    const { startCommandWorker } = await loadWorker()

    startCommandWorker()
    signalHandler(signal)()

    expect(mocks.abortAllRuns).toHaveBeenCalledWith('interrupted')
  })

  it('tick が終わっていても、実行が残っていればドレインは busy', async () => {
    const { startCommandWorker } = await loadWorker()

    startCommandWorker()
    const [name, isBusy] = mocks.registerMaintenanceDrainSource.mock.calls[0]
    expect(name).toBe('command')
    expect(isBusy()).toBe(false)

    mocks.runningCount.mockReturnValue(1)
    expect(isBusy()).toBe(true)
  })
})

describe('kickCommandDispatch', () => {
  it('レスポンス後に 1 tick を予約する', async () => {
    const { kickCommandDispatch } = await loadWorker()

    kickCommandDispatch()
    await mocks.after.mock.calls[0][0]()

    expect(mocks.runCommandDispatch).toHaveBeenCalledTimes(1)
  })

  it('無効なら予約しない', async () => {
    mocks.env.COMMAND_WORKER_ENABLED = false
    const { kickCommandDispatch } = await loadWorker()

    kickCommandDispatch()

    expect(mocks.after).not.toHaveBeenCalled()
  })
})
