/**
 * 通知ワーカーの起動と駆動の単体テスト
 *
 * 配信そのものは差し替え、定期実行・kick・失敗時の継続・拾い直しを見る。
 * `started` はモジュール変数なので、テストごとにモジュールを読み直す。
 */

import { NOTIFY_TICK_MS } from '@/lib/notify/notify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runNotifyDispatch: vi.fn<() => Promise<void>>(),
  enabled: vi.fn<() => boolean>(),
  after: vi.fn(),
  isMaintenanceMode: vi.fn(() => false),
}))

vi.mock('@/lib/notify/notify-dispatch', () => ({ runNotifyDispatch: () => mocks.runNotifyDispatch() }))
vi.mock('@/lib/env-util', () => ({
  envu: {
    server: {
      get NOTIFY_WORKER_ENABLED() {
        return mocks.enabled()
      },
    },
  },
}))
vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@/lib/maintenance/maintenance-mode', () => ({
  isMaintenanceMode: mocks.isMaintenanceMode,
  registerMaintenanceDrainSource: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

/** モジュール変数(`started`)を持ち越さないよう読み直す */
const loadWorker = async () => {
  vi.resetModules()
  return await import('@/lib/notify/notify-worker')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  mocks.enabled.mockReturnValue(true)
  mocks.isMaintenanceMode.mockReturnValue(false)
  mocks.runNotifyDispatch.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startNotifyWorker', () => {
  it('無効ならタイマーを張らない', async () => {
    mocks.enabled.mockReturnValue(false)
    const { startNotifyWorker } = await loadWorker()

    startNotifyWorker()
    await vi.advanceTimersByTimeAsync(NOTIFY_TICK_MS * 3)

    expect(mocks.runNotifyDispatch).not.toHaveBeenCalled()
  })

  it('起動直後は回さず、間隔ごとに回る', async () => {
    const { startNotifyWorker } = await loadWorker()

    startNotifyWorker()
    expect(mocks.runNotifyDispatch).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(NOTIFY_TICK_MS)
    expect(mocks.runNotifyDispatch).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(NOTIFY_TICK_MS * 2)
    expect(mocks.runNotifyDispatch).toHaveBeenCalledTimes(3)
  })

  it('配信が失敗しても次の周は動く', async () => {
    mocks.runNotifyDispatch.mockRejectedValueOnce(new Error('boom'))
    const { startNotifyWorker } = await loadWorker()

    startNotifyWorker()
    await vi.advanceTimersByTimeAsync(NOTIFY_TICK_MS * 2)

    expect(mocks.runNotifyDispatch).toHaveBeenCalledTimes(2)
  })

  it('配信中に来た駆動要求は、終わってからもう 1 周して拾う', async () => {
    let finish!: () => void
    mocks.runNotifyDispatch.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    const { startNotifyWorker, kickNotifyDispatch } = await loadWorker()

    startNotifyWorker()
    await vi.advanceTimersByTimeAsync(NOTIFY_TICK_MS)
    kickNotifyDispatch()
    await mocks.after.mock.calls[0][0]()
    expect(mocks.runNotifyDispatch).toHaveBeenCalledTimes(1)

    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.runNotifyDispatch).toHaveBeenCalledTimes(2)
  })

  it('メンテナンス中は回さない', async () => {
    mocks.isMaintenanceMode.mockReturnValue(true)
    const { startNotifyWorker } = await loadWorker()

    startNotifyWorker()
    await vi.advanceTimersByTimeAsync(NOTIFY_TICK_MS * 2)

    expect(mocks.runNotifyDispatch).not.toHaveBeenCalled()
  })
})

describe('kickNotifyDispatch', () => {
  it('レスポンス後に 1 周を予約する', async () => {
    const { kickNotifyDispatch } = await loadWorker()

    kickNotifyDispatch()
    expect(mocks.after).toHaveBeenCalledTimes(1)
    expect(mocks.runNotifyDispatch).not.toHaveBeenCalled()

    await mocks.after.mock.calls[0][0]()
    expect(mocks.runNotifyDispatch).toHaveBeenCalledTimes(1)
  })

  it('無効なら予約しない', async () => {
    mocks.enabled.mockReturnValue(false)
    const { kickNotifyDispatch } = await loadWorker()

    kickNotifyDispatch()

    expect(mocks.after).not.toHaveBeenCalled()
  })

  it('リクエスト文脈の外では投げずに定期実行へ任せる', async () => {
    mocks.after.mockImplementationOnce(() => {
      throw new Error('outside request scope')
    })
    const { kickNotifyDispatch } = await loadWorker()

    expect(() => kickNotifyDispatch()).not.toThrow()
  })
})
