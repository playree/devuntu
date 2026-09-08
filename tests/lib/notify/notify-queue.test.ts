/**
 * 通知キューの後始末の単体テスト
 *
 * 送れた行は消し、失敗した行だけを原因追跡のために一定期間残す。
 * 残す条件と消す条件の取り違えは「通知が消えない」「原因が追えない」の両方になるので固定する。
 */

import { NOTIFY_FAILED_RETENTION_MS } from '@/lib/notify/notify'
import { purge } from '@/lib/notify/notify-queue'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    notifyOutbox: { deleteMany: vi.fn() },
    notifyDelivery: { deleteMany: vi.fn() },
  },
}))

const now = new Date('2026-09-08T10:00:00.000Z')
const failedBefore = new Date(now.getTime() - NOTIFY_FAILED_RETENTION_MS)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.notifyOutbox.deleteMany).mockResolvedValue({ count: 0 })
  vi.mocked(prisma.notifyDelivery.deleteMany).mockResolvedValue({ count: 0 })
})

describe('purge', () => {
  it('配信を作り終えたアウトボックスは即座に消す', async () => {
    await purge(now)
    expect(vi.mocked(prisma.notifyOutbox.deleteMany).mock.calls[0][0]).toEqual({
      where: { status: 'done', deliveries: { none: {} } },
    })
  })

  it('試行を使い切った配信は保持期間を過ぎてから消す', async () => {
    await purge(now)
    expect(vi.mocked(prisma.notifyDelivery.deleteMany).mock.calls[0][0]).toEqual({
      where: { status: 'failed', failedAt: { lt: failedBefore } },
    })
  })

  it('展開できずに終わったアウトボックスも保持期間を過ぎたら消す', async () => {
    // 配信行が作られないため、他の2つの条件のどちらにも当たらず残り続けていた
    await purge(now)
    expect(vi.mocked(prisma.notifyOutbox.deleteMany).mock.calls[1][0]).toEqual({
      where: { status: 'failed', failedAt: { lt: failedBefore } },
    })
  })

  it('保持期間内の失敗は残す', async () => {
    await purge(now)
    const where = vi.mocked(prisma.notifyOutbox.deleteMany).mock.calls[1][0]?.where as {
      failedAt: { lt: Date }
    }
    expect(where.failedAt.lt.getTime()).toBeLessThan(now.getTime())
  })

  it('作成が古くても失敗したばかりの配信は消さない', async () => {
    // ワーカーが長く止まると、保持期間より古い pending が溜まる。作成日時を起点にすると
    // それらが failed になった瞬間に消え、原因を追う余地が無くなる
    await purge(now)
    const where = vi.mocked(prisma.notifyDelivery.deleteMany).mock.calls[0][0]?.where as Record<string, unknown>
    expect(where).not.toHaveProperty('createdAt')
    expect(where.failedAt).toEqual({ lt: failedBefore })
  })

  it('作成が古くても失敗したばかりのアウトボックスは消さない', async () => {
    await purge(now)
    const where = vi.mocked(prisma.notifyOutbox.deleteMany).mock.calls[1][0]?.where as Record<string, unknown>
    expect(where).not.toHaveProperty('createdAt')
    expect(where.failedAt).toEqual({ lt: failedBefore })
  })
})
