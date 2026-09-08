/**
 * メンテナンスワーカーの起動と駆動の単体テスト
 *
 * 掃除そのものは差し替え、タイマーの張り方だけを見る。
 * `started` はモジュール変数なので、テストごとにモジュールを読み直す。
 */

import { MAINTENANCE_START_DELAY_MS, MAINTENANCE_TICK_MS } from '@/lib/maintenance/maintenance'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runMaintenanceSweep = vi.fn()
vi.mock('@/lib/maintenance/maintenance-sweep', () => ({
  runMaintenanceSweep: () => runMaintenanceSweep(),
}))

const enabled = vi.fn()
vi.mock('@/lib/env-util', () => ({
  envu: {
    server: {
      get MAINTENANCE_WORKER_ENABLED() {
        return enabled()
      },
    },
  },
}))

/** モジュール変数(`started`)を持ち越さないよう読み直す */
const loadWorker = async () => {
  vi.resetModules()
  return (await import('@/lib/maintenance/maintenance-worker')).startMaintenanceWorker
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  enabled.mockReturnValue(true)
  runMaintenanceSweep.mockResolvedValue({})
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startMaintenanceWorker', () => {
  it('無効ならタイマーを張らない', async () => {
    enabled.mockReturnValue(false)
    const start = await loadWorker()

    start()

    await vi.advanceTimersByTimeAsync(MAINTENANCE_START_DELAY_MS + MAINTENANCE_TICK_MS)
    expect(runMaintenanceSweep).not.toHaveBeenCalled()
  })

  it('起動直後は回さず、初回の待ちを置いてから1周する', async () => {
    const start = await loadWorker()

    start()
    expect(runMaintenanceSweep, '起動処理と重ねない').not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(MAINTENANCE_START_DELAY_MS)
    expect(runMaintenanceSweep).toHaveBeenCalledTimes(1)
  })

  it('以降は間隔ごとに回る', async () => {
    const start = await loadWorker()

    start()
    await vi.advanceTimersByTimeAsync(MAINTENANCE_START_DELAY_MS + MAINTENANCE_TICK_MS * 2)

    expect(runMaintenanceSweep).toHaveBeenCalledTimes(3)
  })

  it('掃除が失敗しても次の周は動く', async () => {
    runMaintenanceSweep.mockRejectedValueOnce(new Error('boom'))
    const start = await loadWorker()

    start()
    await vi.advanceTimersByTimeAsync(MAINTENANCE_START_DELAY_MS + MAINTENANCE_TICK_MS)

    expect(runMaintenanceSweep).toHaveBeenCalledTimes(2)
  })

  it('前の周が終わっていなければ重ねない', async () => {
    // 間隔より長く掛かる掃除
    runMaintenanceSweep.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, MAINTENANCE_TICK_MS * 3)))
    const start = await loadWorker()

    start()
    await vi.advanceTimersByTimeAsync(MAINTENANCE_START_DELAY_MS + MAINTENANCE_TICK_MS * 2)

    expect(runMaintenanceSweep).toHaveBeenCalledTimes(1)
  })

  it('2度呼んでもタイマーは1つだけ', async () => {
    const start = await loadWorker()

    start()
    start()
    await vi.advanceTimersByTimeAsync(MAINTENANCE_START_DELAY_MS)

    expect(runMaintenanceSweep).toHaveBeenCalledTimes(1)
  })
})
