/**
 * バックグラウンドワーカーの共通ループの単体テスト
 *
 * タイマーの張り方・1 周の重なり・失敗時の継続・メンテナンス中の停止・kick の扱いを固定する。
 */

import { createWorkerLoop } from '@/lib/worker-loop'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  isMaintenanceMode: vi.fn(),
  registerMaintenanceDrainSource: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@/lib/maintenance/maintenance-mode', () => ({
  isMaintenanceMode: mocks.isMaintenanceMode,
  registerMaintenanceDrainSource: mocks.registerMaintenanceDrainSource,
}))
vi.mock('@/lib/logger', () => ({ logger: mocks.logger }))

const INTERVAL = 1_000
const DELAY = 300

const run = vi.fn<() => Promise<unknown>>()
const isEnabled = vi.fn<() => boolean>()

const createLoop = (opts: Partial<Parameters<typeof createWorkerLoop>[0]> = {}) =>
  createWorkerLoop({
    name: 'test',
    run,
    failedMessage: 'test failed',
    intervalMs: INTERVAL,
    rerunPending: true,
    isEnabled,
    ...opts,
  })

/** 登録されたドレインの判定関数 */
const drainIsBusy = (): (() => boolean) => mocks.registerMaintenanceDrainSource.mock.calls[0][1]

/** `after()` に渡された処理 */
const afterTask = (): (() => Promise<void>) => mocks.after.mock.calls[0][0]

/** 外から解決できる Promise */
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  run.mockReset()
  run.mockResolvedValue(undefined)
  isEnabled.mockReturnValue(true)
  mocks.isMaintenanceMode.mockReturnValue(false)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('start', () => {
  it('無効ならタイマーも起動時の処理もドレインの登録もしない', async () => {
    isEnabled.mockReturnValue(false)
    const onStart = vi.fn()
    const loop = createLoop({ onStart })

    loop.start()
    await vi.advanceTimersByTimeAsync(INTERVAL * 3)

    expect(run).not.toHaveBeenCalled()
    expect(onStart).not.toHaveBeenCalled()
    expect(mocks.registerMaintenanceDrainSource).not.toHaveBeenCalled()
    expect(mocks.logger.info).toHaveBeenCalledWith('test worker disabled')
  })

  it('無効で呼んだ後に有効になれば、次の start で起動できる', async () => {
    isEnabled.mockReturnValue(false)
    const loop = createLoop()
    loop.start()

    isEnabled.mockReturnValue(true)
    loop.start()
    await vi.advanceTimersByTimeAsync(INTERVAL)

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('初回の遅延が無ければ、最初の間隔が来るまで回さない', async () => {
    const loop = createLoop()

    loop.start()
    await vi.advanceTimersByTimeAsync(INTERVAL - 1)
    expect(run).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('intervalFromFirstRun なら初回の後から間隔を刻む', async () => {
    const loop = createLoop({ startDelayMs: DELAY, intervalFromFirstRun: true })

    loop.start()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(run).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(INTERVAL - 1)
    expect(run, '起動からの間隔ではまだ回らない').toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('intervalFromFirstRun でなければ、初回とは別に起動時から間隔を刻む', async () => {
    const loop = createLoop({ startDelayMs: DELAY })

    loop.start()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(run).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(INTERVAL - DELAY)
    expect(run).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('2度呼んでもタイマーと起動時の処理は1度だけ', async () => {
    const onStart = vi.fn()
    const loop = createLoop({ onStart })

    loop.start()
    loop.start()
    await vi.advanceTimersByTimeAsync(INTERVAL)

    expect(run).toHaveBeenCalledTimes(1)
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(mocks.registerMaintenanceDrainSource).toHaveBeenCalledTimes(1)
  })

  it('ドレインには名前を付けて登録する', () => {
    createLoop().start()

    expect(mocks.registerMaintenanceDrainSource).toHaveBeenCalledWith('test', expect.any(Function))
  })
})

describe('tick', () => {
  it('メンテナンス中は回さず、解除されれば次の間隔で回る', async () => {
    mocks.isMaintenanceMode.mockReturnValue(true)
    const loop = createLoop()

    loop.start()
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(run).not.toHaveBeenCalled()

    mocks.isMaintenanceMode.mockReturnValue(false)
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('1 周が失敗してもログを残し、次の周は動く', async () => {
    const error = new Error('boom')
    run.mockRejectedValueOnce(error)
    const loop = createLoop()

    loop.start()
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(mocks.logger.error).toHaveBeenCalledWith({ error }, 'test failed')

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('rerunPending なら、実行中に来た駆動要求を終わってから 1 周だけ拾う', async () => {
    const first = deferred()
    run.mockReturnValueOnce(first.promise)
    const loop = createLoop()

    loop.start()
    await vi.advanceTimersByTimeAsync(INTERVAL)
    // 実行中に 2 回来ても、拾い直しは 1 周にまとまる
    await vi.advanceTimersByTimeAsync(INTERVAL * 2)
    expect(run).toHaveBeenCalledTimes(1)

    first.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('rerunPending でなければ、実行中に来た駆動要求は捨てて次の間隔を待つ', async () => {
    const first = deferred()
    run.mockReturnValueOnce(first.promise)
    const loop = createLoop({ rerunPending: false })

    loop.start()
    await vi.advanceTimersByTimeAsync(INTERVAL * 2)
    expect(run).toHaveBeenCalledTimes(1)

    first.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('拾い直しの周が失敗しても、実行中の状態は解ける', async () => {
    const first = deferred()
    run.mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error('boom'))
    const loop = createLoop()

    loop.start()
    await vi.advanceTimersByTimeAsync(INTERVAL * 2)
    first.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(2)
    expect(drainIsBusy()()).toBe(false)

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(run).toHaveBeenCalledTimes(3)
  })
})

describe('ドレインの判定', () => {
  it('実行中だけ busy になる', async () => {
    const first = deferred()
    run.mockReturnValueOnce(first.promise)
    const loop = createLoop()

    loop.start()
    expect(drainIsBusy()()).toBe(false)

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(drainIsBusy()()).toBe(true)

    first.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(drainIsBusy()()).toBe(false)
  })

  it('isBusy があれば実行中でなくても busy に足す', () => {
    const isBusy = vi.fn(() => true)
    createLoop({ isBusy }).start()

    expect(drainIsBusy()()).toBe(true)

    isBusy.mockReturnValue(false)
    expect(drainIsBusy()()).toBe(false)
  })
})

describe('kick', () => {
  it('無効なら after() を予約しない', () => {
    isEnabled.mockReturnValue(false)

    createLoop().kick()

    expect(mocks.after).not.toHaveBeenCalled()
  })

  it('after() に 1 周を予約し、start していなくても回る', async () => {
    const loop = createLoop()

    loop.kick()
    expect(run).not.toHaveBeenCalled()

    await afterTask()()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('予約した周もメンテナンス中は回さない', async () => {
    mocks.isMaintenanceMode.mockReturnValue(true)
    const loop = createLoop()

    loop.kick()
    await afterTask()()

    expect(run).not.toHaveBeenCalled()
  })

  it('リクエスト文脈の外で after() が投げても握り潰す', () => {
    mocks.after.mockImplementationOnce(() => {
      throw new Error('outside request scope')
    })

    expect(() => createLoop().kick()).not.toThrow()
  })
})
