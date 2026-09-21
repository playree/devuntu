/**
 * メンテナンスモードの監視の単体テスト
 *
 * ここの守りは「**実行中のワーカーが終わってから**接続を手放す」こと。
 * 先に切るとワーカーの最終書き込みが接続を張り直し、リストア側の接続チェックが
 * 「0になった」と誤って判断してしまう。フラグの有無と経過時間を作って順序を固定する。
 *
 * `watched` / `disconnected` はモジュール変数なので、テストごとにモジュールを読み直す。
 */

import { MAINTENANCE_MODE_WATCH_MS } from '@/lib/maintenance/maintenance'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const $disconnect = vi.fn()
vi.mock('@/lib/prisma', () => ({ prisma: { $disconnect: () => $disconnect() } }))

const existsSync = vi.fn()
vi.mock('node:fs', () => ({ existsSync: (path: string) => existsSync(path) }))

vi.mock('@/lib/env-util', () => ({
  envu: { server: { MAINTENANCE_MODE_FILE: '/tmp/devuntu-test/maintenance' } },
}))

const loadModule = async () => {
  vi.resetModules()
  return await import('@/lib/maintenance/maintenance-mode')
}

/** 1周ぶん進める。`$disconnect` は動的 import 越しなので、解決を待つために少し余分に回す */
const advanceTick = async (times = 1) => {
  for (let i = 0; i < times; i++) {
    await vi.advanceTimersByTimeAsync(MAINTENANCE_MODE_WATCH_MS)
  }
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  $disconnect.mockResolvedValue(undefined)
  existsSync.mockReturnValue(false)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startMaintenanceModeWatcher: ワーカーが終わるまで接続を手放さない', () => {
  it('遮断していなければ切らない', async () => {
    const { startMaintenanceModeWatcher } = await loadModule()

    startMaintenanceModeWatcher()
    await advanceTick(3)

    expect($disconnect).not.toHaveBeenCalled()
  })

  it('処理中のワーカーがいる間は切らず、全員終わった周で1度だけ切る', async () => {
    const { registerMaintenanceDrainSource, startMaintenanceModeWatcher } = await loadModule()
    let busy = true
    registerMaintenanceDrainSource('command', () => busy)
    registerMaintenanceDrainSource('notify', () => false)

    startMaintenanceModeWatcher()
    existsSync.mockReturnValue(true)

    await advanceTick(2)
    expect($disconnect, '実行中のものが残っている間は待つ').not.toHaveBeenCalled()

    busy = false
    await advanceTick()
    expect($disconnect).toHaveBeenCalledTimes(1)

    // 切った後は同じ遮断の間、何度周っても切り直さない
    await advanceTick(3)
    expect($disconnect).toHaveBeenCalledTimes(1)
  })

  it('待つ相手がいなければ最初の周で切る', async () => {
    const { startMaintenanceModeWatcher } = await loadModule()

    startMaintenanceModeWatcher()
    existsSync.mockReturnValue(true)
    await advanceTick()

    expect($disconnect).toHaveBeenCalledTimes(1)
  })

  it('起動時点で遮断中でも切る', async () => {
    existsSync.mockReturnValue(true)
    const { startMaintenanceModeWatcher } = await loadModule()

    startMaintenanceModeWatcher()
    await advanceTick()

    expect($disconnect).toHaveBeenCalledTimes(1)
  })

  it('解除してから遮断し直すと、もう一度切る', async () => {
    const { startMaintenanceModeWatcher } = await loadModule()

    startMaintenanceModeWatcher()
    existsSync.mockReturnValue(true)
    await advanceTick()
    expect($disconnect).toHaveBeenCalledTimes(1)

    existsSync.mockReturnValue(false)
    await advanceTick()

    existsSync.mockReturnValue(true)
    await advanceTick()
    expect($disconnect).toHaveBeenCalledTimes(2)
  })

  it('2度呼んでもタイマーは1つだけ', async () => {
    const { startMaintenanceModeWatcher } = await loadModule()

    startMaintenanceModeWatcher()
    startMaintenanceModeWatcher()
    existsSync.mockReturnValue(true)
    await advanceTick()

    expect($disconnect).toHaveBeenCalledTimes(1)
  })
})

describe('isMaintenanceMode: stat は間隔を空ける', () => {
  it('間隔の内は前回の結果を返す', async () => {
    const { isMaintenanceMode } = await loadModule()

    expect(isMaintenanceMode()).toBe(false)
    existsSync.mockReturnValue(true)

    expect(isMaintenanceMode(), 'キャッシュが効いている間は見に行かない').toBe(false)
    expect(existsSync).toHaveBeenCalledTimes(1)
  })
})
