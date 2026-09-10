/**
 * 外部URLからの画像取得の単体テスト
 *
 * ログインの途中で外部へ出ていく処理なので、取得先・サイズ・リダイレクトの
 * 上限が効いていること、どの失敗でも例外にせず undefined で返ることを確認する。
 */

import { MAX_IMAGE_SIZE } from '@/lib/schema/schema'
import { fetchRemoteImage } from '@/lib/storage/remote-image'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()

const bodyOf = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(bytes)
      controller.close()
    },
  })

const okResponse = (bytes: Uint8Array) => ({ ok: true, status: 200, body: bodyOf(bytes), headers: new Headers() })

const redirectTo = (location: string) => ({
  ok: false,
  status: 302,
  body: null,
  headers: new Headers({ location }),
})

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchRemoteImage', () => {
  it('画像を読み切って返す', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    fetchMock.mockResolvedValue(okResponse(bytes))

    await expect(fetchRemoteImage('https://idp.example.com/a.png')).resolves.toEqual(bytes)
  })

  it('相対パスは取得しない', async () => {
    await expect(fetchRemoteImage('/api/upload/a.webp')).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('http/https 以外のスキームは取得しない', async () => {
    await expect(fetchRemoteImage('file:///etc/passwd')).resolves.toBeUndefined()
    await expect(fetchRemoteImage('data:image/png;base64,AAAA')).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('リダイレクトを自分で追う', async () => {
    const bytes = new Uint8Array([9])
    fetchMock.mockResolvedValueOnce(redirectTo('/moved.png')).mockResolvedValueOnce(okResponse(bytes))

    await expect(fetchRemoteImage('https://idp.example.com/a.png')).resolves.toEqual(bytes)
    expect(fetchMock.mock.calls[1][0].toString()).toBe('https://idp.example.com/moved.png')
  })

  it('http/https 以外へのリダイレクトは追わない', async () => {
    fetchMock.mockResolvedValue(redirectTo('file:///etc/passwd'))

    await expect(fetchRemoteImage('https://idp.example.com/a.png')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('リダイレクトが続く場合は打ち切る', async () => {
    fetchMock.mockResolvedValue(redirectTo('https://idp.example.com/next.png'))

    await expect(fetchRemoteImage('https://idp.example.com/a.png')).resolves.toBeUndefined()
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5)
  })

  it('上限を超えたら読み切らずに捨てる', async () => {
    fetchMock.mockResolvedValue(okResponse(new Uint8Array(MAX_IMAGE_SIZE + 1)))

    await expect(fetchRemoteImage('https://idp.example.com/big.png')).resolves.toBeUndefined()
  })

  it('エラー応答は取得しない', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, body: null, headers: new Headers() })

    await expect(fetchRemoteImage('https://idp.example.com/a.png')).resolves.toBeUndefined()
  })

  it('通信に失敗しても例外にしない', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'))

    await expect(fetchRemoteImage('https://idp.example.com/a.png')).resolves.toBeUndefined()
  })
})
