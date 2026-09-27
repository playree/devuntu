/**
 * アバターの未認証配信(`/api/avatar/<キー>`)の単体テスト
 *
 * ここだけ認証を外しているので、配信の条件を誤ると `boardId: null` の添付
 * (お知らせ本文の画像・リンクウィジェットのアイコン)まで全世界に開いてしまう。
 * 「今この瞬間アバターとして参照されているキーだけ」を固定する。
 */

import { GET } from '@/app/api/avatar/[filename]/route'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit } from '@/lib/rate-limit'
import { WEBP_MIME } from '@/lib/storage/image'
import { getObject } from '@/lib/storage/storage'
import { toUploadUrl } from '@/lib/storage/upload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findFirst: vi.fn() } } }))
vi.mock('@/lib/storage/storage', () => ({ getObject: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ consumeRateLimit: vi.fn() }))
vi.mock('@/lib/server-utils', () => ({ getClientIp: async () => '203.0.113.1' }))

const key = '019eef64-6cc1-78f1-8f50-1ef86986289a.webp'

const call = (filename: string) => GET(new Request('http://localhost:3000'), { params: Promise.resolve({ filename }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(consumeRateLimit).mockReturnValue(true)
  vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'u1' } as never)
  vi.mocked(getObject).mockResolvedValue({ body: new ReadableStream(), contentLength: 42 })
})

describe('GET /api/avatar/[filename]', () => {
  it('アバターとして参照されているキーは配信する', async () => {
    const res = await call(key)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe(WEBP_MIME)
    // 削除後も共有キャッシュが返し続けないよう、期限なし(immutable)にはしない
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600')
    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { image: toUploadUrl(key) }, select: { id: true } })
  })

  it('アバターではない添付は、実体があっても配信しない', async () => {
    // お知らせ本文の画像やリンクウィジェットのアイコンがこれに当たる
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)

    const res = await call(key)

    expect(res.status).toBe(404)
    expect(getObject).not.toHaveBeenCalled()
  })

  it('キーの形式が違えばDBに触らず落とす', async () => {
    const res = await call('../../etc/passwd')

    expect(res.status).toBe(400)
    expect(consumeRateLimit).not.toHaveBeenCalled()
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
  })

  it('実体が無ければ404', async () => {
    vi.mocked(getObject).mockResolvedValue(null)

    expect((await call(key)).status).toBe(404)
  })

  it('レート制限を超えたら429', async () => {
    vi.mocked(consumeRateLimit).mockReturnValue(false)

    const res = await call(key)

    expect(res.status).toBe(429)
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
  })
})
