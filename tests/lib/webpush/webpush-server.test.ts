/**
 * Web プッシュの送信結果の分類と購読の保存の単体テスト
 *
 * 再試行の判断は `notify-queue.ts` の 1 箇所に集めているので、
 * 「どのステータスをどの結果へ落とすか」だけを固定すればよい。
 */

import { prisma } from '@/lib/prisma'
import { classifyWebPushStatus, saveWebPushSubscription } from '@/lib/webpush/webpush-server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    webPushSubscription: ['findUnique', 'upsert', 'deleteMany', 'findMany'],
  }),
)

describe('classifyWebPushStatus: HTTP ステータスの分類', () => {
  it('失効(404 / 410)はその端末だけ諦める', () => {
    // 購読が無効になった時点でプッシュサービスがこれを返す。行を消して宛先から外す
    expect(classifyWebPushStatus(404)).toBe('unlinked')
    expect(classifyWebPushStatus(410)).toBe('unlinked')
  })

  it('鍵の不正(401 / 403)は打ち切り相当(全端末で起きていれば構成障害)', () => {
    expect(classifyWebPushStatus(401)).toBe('revoked')
    expect(classifyWebPushStatus(403)).toBe('revoked')
  })

  it('429 はレート制限として再試行に回す', () => {
    expect(classifyWebPushStatus(429)).toBe('rate_limited')
  })

  it('5xx は一時障害として再試行に回す', () => {
    expect(classifyWebPushStatus(500)).toBe('retryable')
    expect(classifyWebPushStatus(502)).toBe('retryable')
    expect(classifyWebPushStatus(503)).toBe('retryable')
  })

  it('その他とステータス不明は failed に寄せる(仕様が増えても壊れない)', () => {
    expect(classifyWebPushStatus(400)).toBe('failed')
    expect(classifyWebPushStatus(413)).toBe('failed')
    expect(classifyWebPushStatus(undefined)).toBe('failed')
  })
})

describe('saveWebPushSubscription: 購読の保存', () => {
  const input = { endpoint: 'https://push.example.com/abc', p256dh: 'key-a', auth: 'auth-a' }

  beforeEach(() => {
    vi.mocked(prisma.webPushSubscription.findUnique).mockReset()
    vi.mocked(prisma.webPushSubscription.upsert).mockReset()
    vi.mocked(prisma.webPushSubscription.deleteMany).mockReset()
    vi.mocked(prisma.webPushSubscription.findMany).mockResolvedValue([])
  })

  it('新しいエンドポイントは登録する', async () => {
    vi.mocked(prisma.webPushSubscription.findUnique).mockResolvedValue(null)
    await saveWebPushSubscription('u1', input)
    expect(prisma.webPushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ userId: 'u1', endpoint: input.endpoint }) }),
    )
  })

  it('自分の購読は鍵が変わっていても更新する', async () => {
    vi.mocked(prisma.webPushSubscription.findUnique).mockResolvedValue({
      userId: 'u1',
      p256dh: 'old-key',
      auth: 'old-auth',
    } as never)
    await saveWebPushSubscription('u1', input)
    expect(prisma.webPushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ userId: 'u1', p256dh: 'key-a', auth: 'auth-a' }) }),
    )
  })

  it('他人の購読でも鍵が一致すれば(同じブラウザでのアカウント切替)持ち主を移す', async () => {
    vi.mocked(prisma.webPushSubscription.findUnique).mockResolvedValue({
      userId: 'u2',
      p256dh: 'key-a',
      auth: 'auth-a',
    } as never)
    await saveWebPushSubscription('u1', input)
    expect(prisma.webPushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ userId: 'u1' }) }),
    )
  })

  it('他人の購読で鍵が違えば、エラーにせず何も変えない', async () => {
    vi.mocked(prisma.webPushSubscription.findUnique).mockResolvedValue({
      userId: 'u2',
      p256dh: 'key-b',
      auth: 'auth-a',
    } as never)
    await expect(
      saveWebPushSubscription('u1', { ...input, replacedEndpoint: 'https://push.example.com/old' }),
    ).resolves.toBeUndefined()
    expect(prisma.webPushSubscription.upsert).not.toHaveBeenCalled()
    expect(prisma.webPushSubscription.deleteMany).not.toHaveBeenCalled()
  })
})
