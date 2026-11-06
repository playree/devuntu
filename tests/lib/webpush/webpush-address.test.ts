/**
 * Web プッシュの送信先を名前解決の結果で確かめる処理の単体テスト
 */

import { guardedLookup, isPrivateAddressError } from '@/lib/webpush/webpush-address'
import { lookup as dnsLookup } from 'node:dns'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:dns', () => ({ lookup: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('guardedLookup: 接続時の名前解決', () => {
  const givenResolved = (address: unknown, family?: number) => {
    vi.mocked(dnsLookup).mockImplementation(((
      _host: string,
      _options: unknown,
      callback: (...args: unknown[]) => void,
    ) => callback(null, address, family)) as never)
  }

  it('公開アドレスはそのまま返す(all 指定の配列も)', () => {
    const callback = vi.fn()
    givenResolved('8.8.8.8', 4)
    guardedLookup('push.example.com', {}, callback)
    expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4)

    givenResolved([{ address: '2001:4860:4860::8888', family: 6 }])
    guardedLookup('push.example.com', { all: true }, callback)
    expect(callback).toHaveBeenLastCalledWith(null, [{ address: '2001:4860:4860::8888', family: 6 }], undefined)
  })

  it('引けなかったときのエラーはそのまま返す(内部のアドレスとは扱わない)', () => {
    const callback = vi.fn()
    const notFound = Object.assign(new Error('not found'), { code: 'ENOTFOUND' })
    vi.mocked(dnsLookup).mockImplementation(((_host: string, _options: unknown, cb: (...args: unknown[]) => void) =>
      cb(notFound, '', 4)) as never)
    guardedLookup('nowhere.invalid', {}, callback)
    expect(callback.mock.calls[0][0]).toBe(notFound)
    expect(isPrivateAddressError(notFound)).toBe(false)
  })

  it('内部のアドレスに解決されたら接続させない', () => {
    const callback = vi.fn()
    givenResolved([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ])
    guardedLookup('rebind.example.com', { all: true }, callback)
    expect(isPrivateAddressError(callback.mock.calls[0][0])).toBe(true)
  })
})
