/** アバターなど、利用者が参照先を指せる値から添付を消すときは本人の添付に限る */

import { prisma } from '@/lib/prisma'
import { removeOwnedImageAttachment } from '@/lib/storage/attachment'
import { deleteObject } from '@/lib/storage/storage'
import { toUploadUrl } from '@/lib/storage/upload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({ attachment: ['count', 'deleteMany'] }),
)
vi.mock('@/lib/storage/storage', () => ({ deleteObject: vi.fn(), putObject: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const KEY = '019eef64-6cc1-78f1-8f50-1ef86986289a.webp'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('removeOwnedImageAttachment', () => {
  it('本人がアップロードしたボード外の添付なら消す', async () => {
    vi.mocked(prisma.attachment.count).mockResolvedValue(1)

    await removeOwnedImageAttachment(toUploadUrl(KEY), 'u1')

    expect(prisma.attachment.count).toHaveBeenCalledWith({ where: { key: KEY, createdById: 'u1', boardId: null } })
    expect(deleteObject).toHaveBeenCalledWith(KEY)
  })

  it('他人の添付やボードの添付は消さない', async () => {
    vi.mocked(prisma.attachment.count).mockResolvedValue(0)

    await removeOwnedImageAttachment(toUploadUrl(KEY), 'u1')

    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('所有者の確認に失敗しても例外にせず、消さずに戻る', async () => {
    vi.mocked(prisma.attachment.count).mockRejectedValue(new Error('db down'))

    await expect(removeOwnedImageAttachment(toUploadUrl(KEY), 'u1')).resolves.toBeUndefined()
    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('管理外の URL は何もしない', async () => {
    await removeOwnedImageAttachment('https://example.com/a.png', 'u1')

    expect(prisma.attachment.count).not.toHaveBeenCalled()
  })
})
