/**
 * 実行の進捗の合図の単体テスト
 *
 * 合図・タイムアウト・切断のどれで戻っても、待ちの登録が残らないことを固定する。
 */

import { signalRun, waitForRunSignal } from '@/lib/command/command-signal'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const TIMEOUT = 1_000

/** Promise が解決済みかを、タイマーを進めずに調べる */
const isSettled = async (promise: Promise<unknown>): Promise<boolean> => {
  let settled = false
  void promise.then(() => {
    settled = true
  })
  await Promise.resolve()
  await Promise.resolve()
  return settled
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('waitForRunSignal', () => {
  it('合図が来たらタイムアウトを待たずに戻る', async () => {
    const wait = waitForRunSignal('run-signal', TIMEOUT, new AbortController().signal)
    expect(await isSettled(wait)).toBe(false)

    signalRun('run-signal')

    expect(await isSettled(wait)).toBe(true)
    expect(vi.getTimerCount(), 'タイムアウトのタイマーは片付ける').toBe(0)
  })

  it('別の実行への合図では戻らない', async () => {
    const wait = waitForRunSignal('run-mine', TIMEOUT, new AbortController().signal)

    signalRun('run-other')

    expect(await isSettled(wait)).toBe(false)
    await vi.advanceTimersByTimeAsync(TIMEOUT)
  })

  it('合図が来なくてもタイムアウトで戻る', async () => {
    const wait = waitForRunSignal('run-timeout', TIMEOUT, new AbortController().signal)

    await vi.advanceTimersByTimeAsync(TIMEOUT - 1)
    expect(await isSettled(wait)).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(await isSettled(wait)).toBe(true)
  })

  it('切断されたらタイムアウトを待たずに戻る', async () => {
    const controller = new AbortController()
    const wait = waitForRunSignal('run-abort', TIMEOUT, controller.signal)

    controller.abort()

    expect(await isSettled(wait)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('既に切断済みならタイマーも張らずに戻る', async () => {
    const controller = new AbortController()
    controller.abort()

    const wait = waitForRunSignal('run-aborted', TIMEOUT, controller.signal)

    expect(await isSettled(wait)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('同じ実行を複数で待っていれば、1 回の合図で全員が戻る', async () => {
    const waits = [1, 2, 3].map(() => waitForRunSignal('run-multi', TIMEOUT, new AbortController().signal))

    signalRun('run-multi')

    expect(await Promise.all(waits.map(isSettled))).toEqual([true, true, true])
  })

  it('戻った後の合図・切断で二重に処理しない', async () => {
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    const wait = waitForRunSignal('run-once', TIMEOUT, controller.signal)

    await vi.advanceTimersByTimeAsync(TIMEOUT)
    await wait
    signalRun('run-once')
    controller.abort()

    expect(removeListener).toHaveBeenCalledTimes(1)
  })
})

describe('signalRun', () => {
  it('待っている相手がいなくても投げない', () => {
    expect(() => signalRun('run-nobody')).not.toThrow()
  })
})
