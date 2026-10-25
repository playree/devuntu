/**
 * better-auth 標準のエンドポイントのうち、塞いでいるもの。
 *
 * `/update-user` はセッションだけで `user.image` を任意の値にでき、公開アバターの配信判定や
 * アバター削除の対象を他人の添付へ向けられてしまう。
 */

import { auth } from '@/lib/auth/auth'
import { describe, expect, it } from 'vitest'

describe('塞いだエンドポイント', () => {
  it('/update-user は 404 を返す', async () => {
    const res = await auth.handler(
      new Request(new URL('/api/auth/update-user', process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: '/api/upload/00000000-0000-7000-8000-000000000000.webp' }),
      }),
    )
    expect(res.status).toBe(404)
  })
})
