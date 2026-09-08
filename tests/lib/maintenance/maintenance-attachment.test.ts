/**
 * 未参照添付の掃除の単体テスト
 *
 * 掃除の中で唯一の不可逆操作なので、守りが効いていることを重点的に確認する。
 * 猶予・参照の再確認・削除の順序・削除上限・実行間隔がそれぞれ独立して効く。
 */

import { ATTACHMENT_DELETE_MAX, ATTACHMENT_SWEEP_INTERVAL_MS } from '@/lib/maintenance/maintenance'
import { resetAttachmentSweepThrottle, sweepOrphanAttachments } from '@/lib/maintenance/maintenance-attachment'
import { prisma } from '@/lib/prisma'
import { deleteObject } from '@/lib/storage/storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    attachment: { findMany: vi.fn(), deleteMany: vi.fn() },
  },
}))

vi.mock('@/lib/storage/storage', () => ({ deleteObject: vi.fn() }))

const collectReferencedUploadKeys = vi.fn()
const findAttachmentReference = vi.fn()
vi.mock('@/lib/storage/attachment-ref', () => ({
  collectReferencedUploadKeys: () => collectReferencedUploadKeys(),
  findAttachmentReference: (key: string) => findAttachmentReference(key),
}))

const mode = vi.fn()
const graceHours = vi.fn()
vi.mock('@/lib/env-util', () => ({
  envu: {
    server: {
      get MAINTENANCE_ATTACHMENT_MODE() {
        return mode()
      },
      get MAINTENANCE_ATTACHMENT_GRACE_HOURS() {
        return graceHours()
      },
    },
  },
}))

const now = new Date('2026-09-08T10:00:00.000Z')
const orphan = { id: 'a1', key: 'orphan.webp', size: 100 }

beforeEach(() => {
  vi.clearAllMocks()
  resetAttachmentSweepThrottle()
  mode.mockReturnValue('delete')
  graceHours.mockReturnValue(24)
  collectReferencedUploadKeys.mockResolvedValue(new Set<string>())
  findAttachmentReference.mockResolvedValue(null)
  vi.mocked(prisma.attachment.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.attachment.deleteMany).mockResolvedValue({ count: 1 })
  vi.mocked(deleteObject).mockResolvedValue(undefined)
})

describe('猶予', () => {
  it('猶予を過ぎた添付だけを候補にする', async () => {
    await sweepOrphanAttachments(now)
    const where = vi.mocked(prisma.attachment.findMany).mock.calls[0][0]?.where as {
      createdAt: { lt: Date }
    }
    // 既定24時間
    expect(where.createdAt.lt.toISOString()).toBe('2026-09-07T10:00:00.000Z')
  })

  it('猶予は環境変数で変えられる', async () => {
    graceHours.mockReturnValue(1)
    await sweepOrphanAttachments(now)
    const where = vi.mocked(prisma.attachment.findMany).mock.calls[0][0]?.where as {
      createdAt: { lt: Date }
    }
    expect(where.createdAt.lt.toISOString()).toBe('2026-09-08T09:00:00.000Z')
  })
})

describe('参照の判定', () => {
  it('集合に載っているキーは消さない(再確認も引かない)', async () => {
    collectReferencedUploadKeys.mockResolvedValue(new Set([orphan.key]))
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([orphan] as never)

    expect(await sweepOrphanAttachments(now)).toBe(0)
    expect(findAttachmentReference).not.toHaveBeenCalled()
    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('集合に無くても消す直前の再確認で見つかれば残す', async () => {
    // 集合を作ってから本文が保存された場合
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([orphan] as never)
    findAttachmentReference.mockResolvedValue('ticket')

    expect(await sweepOrphanAttachments(now)).toBe(0)
    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('どこからも参照されていなければ消す', async () => {
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([orphan] as never)
    expect(await sweepOrphanAttachments(now)).toBe(1)
  })
})

describe('削除の順序', () => {
  it('実体を消してからレコードを消す', async () => {
    // 逆順だとレコードだけ消えたときにキーを辿れなくなる
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([orphan] as never)
    await sweepOrphanAttachments(now)

    expect(vi.mocked(deleteObject).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.attachment.deleteMany).mock.invocationCallOrder[0],
    )
  })

  it('実体の削除に失敗したらレコードは残す', async () => {
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([orphan] as never)
    vi.mocked(deleteObject).mockRejectedValue(new Error('s3 down'))

    expect(await sweepOrphanAttachments(now)).toBe(0)
    expect(prisma.attachment.deleteMany).not.toHaveBeenCalled()
  })

  it('1件の失敗で残りを止めない', async () => {
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([orphan, { id: 'a2', key: 'other.webp', size: 1 }] as never)
    vi.mocked(deleteObject).mockRejectedValueOnce(new Error('s3 down')).mockResolvedValue(undefined)

    expect(await sweepOrphanAttachments(now)).toBe(1)
  })
})

describe('モード', () => {
  it('dry-run では何も消さない', async () => {
    mode.mockReturnValue('dry-run')
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([orphan] as never)

    expect(await sweepOrphanAttachments(now)).toBe(0)
    expect(deleteObject).not.toHaveBeenCalled()
    expect(prisma.attachment.deleteMany).not.toHaveBeenCalled()
  })

  it('off では参照の収集すら行わない', async () => {
    mode.mockReturnValue('off')
    expect(await sweepOrphanAttachments(now)).toBe(0)
    expect(collectReferencedUploadKeys).not.toHaveBeenCalled()
  })
})

describe('上限と実行間隔', () => {
  it('1周の削除件数を上限で打ち切る', async () => {
    const many = Array.from({ length: ATTACHMENT_DELETE_MAX + 10 }, (_, i) => ({
      id: `a${i}`,
      key: `k${i}.webp`,
      size: 1,
    }))
    vi.mocked(prisma.attachment.findMany).mockResolvedValue(many as never)

    expect(await sweepOrphanAttachments(now)).toBe(ATTACHMENT_DELETE_MAX)
  })

  it('間隔を空けずに呼ばれても2周目は動かない', async () => {
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([orphan] as never)
    await sweepOrphanAttachments(now)

    const soon = new Date(now.getTime() + ATTACHMENT_SWEEP_INTERVAL_MS - 1)
    expect(await sweepOrphanAttachments(soon)).toBe(0)
    expect(collectReferencedUploadKeys).toHaveBeenCalledTimes(1)
  })

  it('間隔が空けば再び動く', async () => {
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([orphan] as never)
    await sweepOrphanAttachments(now)

    const later = new Date(now.getTime() + ATTACHMENT_SWEEP_INTERVAL_MS)
    await sweepOrphanAttachments(later)
    expect(collectReferencedUploadKeys).toHaveBeenCalledTimes(2)
  })
})
