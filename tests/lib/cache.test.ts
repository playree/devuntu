/**
 * 簡易 TTL キャッシュの単体テスト
 *
 * TTL・同時アクセスの合流・失敗時の破棄・上限での追い出しを固定する。
 * エントリはモジュール変数なので、テストごとにモジュールを読み直す。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const MAX_ENTRIES = 1000
const TTL = 1_000

const loadCache = async () => {
  vi.resetModules()
  return await import('@/lib/cache')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('cached', () => {
  it('TTL の間は load を呼ばずに同じ値を返す', async () => {
    const { cached } = await loadCache()
    const load = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')

    expect(await cached('key', TTL, load)).toBe('first')
    vi.advanceTimersByTime(TTL - 1)
    expect(await cached('key', TTL, load)).toBe('first')

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('TTL を過ぎたら取り直す', async () => {
    const { cached } = await loadCache()
    const load = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')

    await cached('key', TTL, load)
    vi.advanceTimersByTime(TTL)

    expect(await cached('key', TTL, load)).toBe('second')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('キーが違えば別々に取得する', async () => {
    const { cached } = await loadCache()

    expect(await cached('a', TTL, async () => 'A')).toBe('A')
    expect(await cached('b', TTL, async () => 'B')).toBe('B')
  })

  it('取得中に届いた呼び出しは 1 回の load に合流する', async () => {
    const { cached } = await loadCache()
    let resolve!: (value: string) => void
    const load = vi.fn(
      () =>
        new Promise<string>((r) => {
          resolve = r
        }),
    )

    const first = cached('key', TTL, load)
    const second = cached('key', TTL, load)
    resolve('value')

    expect(await Promise.all([first, second])).toEqual(['value', 'value'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('load が失敗したら呼び出し元へ投げ、次の呼び出しで取り直す', async () => {
    const { cached } = await loadCache()
    const error = new Error('boom')
    const load = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce('value')

    await expect(cached('key', TTL, load)).rejects.toBe(error)

    expect(await cached('key', TTL, load)).toBe('value')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('失敗した取得より後に入った値は、失敗の後始末で消さない', async () => {
    const { cached, dropCached } = await loadCache()
    let reject!: (error: Error) => void
    const failing = cached(
      'key',
      TTL,
      () =>
        new Promise<string>((_, r) => {
          reject = r
        }),
    )
    dropCached('key')
    const load = vi.fn().mockResolvedValue('fresh')
    await cached('key', TTL, load)

    reject(new Error('boom'))
    await expect(failing).rejects.toThrow('boom')

    expect(await cached('key', TTL, load)).toBe('fresh')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('上限に達したら期限切れを先に捨て、有効なエントリは残す', async () => {
    const { cached } = await loadCache()
    await cached('alive', TTL * 10, async () => 'alive')
    for (let i = 0; i < MAX_ENTRIES - 1; i++) {
      await cached(`short-${i}`, TTL, async () => i)
    }
    vi.advanceTimersByTime(TTL)

    await cached('new', TTL, async () => 'new')

    const load = vi.fn().mockResolvedValue('reloaded')
    expect(await cached('alive', TTL * 10, load)).toBe('alive')
    expect(load).not.toHaveBeenCalled()
  })

  it('上限に達して期限切れが無ければ、古い順に追い出す', async () => {
    const { cached } = await loadCache()
    for (let i = 0; i < MAX_ENTRIES; i++) {
      await cached(`key-${i}`, TTL, async () => i)
    }

    await cached('new', TTL, async () => 'new')

    const oldest = vi.fn().mockResolvedValue('reloaded')
    expect(await cached('key-0', TTL, oldest), '最も古いものは追い出される').toBe('reloaded')
    const second = vi.fn().mockResolvedValue('reloaded')
    expect(await cached('key-2', TTL, second)).toBe(2)
    expect(second).not.toHaveBeenCalled()
  })
})

describe('dropCached', () => {
  it('TTL の間でも次の呼び出しで取り直す', async () => {
    const { cached, dropCached } = await loadCache()
    const load = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')

    await cached('key', TTL, load)
    dropCached('key')

    expect(await cached('key', TTL, load)).toBe('second')
  })

  it('無いキーを捨てても投げない', async () => {
    const { dropCached } = await loadCache()

    expect(() => dropCached('missing')).not.toThrow()
  })
})
