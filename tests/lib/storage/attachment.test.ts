/** アバターなど、利用者が参照先を指せる値から添付を消すときは本人の添付に限る */

import { prisma } from '@/lib/prisma'
import {
  listContentAttachments,
  OCTET_STREAM_MIME,
  removeOwnedImageAttachment,
  saveContentFile,
  toStoredMimeType,
} from '@/lib/storage/attachment'
import { deleteObject, putObject } from '@/lib/storage/storage'
import { toUploadUrl } from '@/lib/storage/upload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({ attachment: ['count', 'deleteMany', 'create', 'findMany'] }),
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

    expect(prisma.attachment.count).toHaveBeenCalledWith({
      where: { key: KEY, createdById: 'u1', boardId: null, wikiSpaceId: null },
    })
    expect(deleteObject).toHaveBeenCalledWith(KEY)
  })

  it('他人の添付やボード・Wiki スペースの添付は消さない', async () => {
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

describe('toStoredMimeType', () => {
  it.each([
    ['application/pdf', 'application/pdf'],
    ['text/plain; charset=utf-8', 'text/plain'],
    ['Application/ZIP', 'application/zip'],
    [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
  ])('通常の形式はそのまま(パラメータは落とす): %s', (type, expected) => {
    expect(toStoredMimeType(type)).toBe(expected)
  })

  it.each([
    ['text/html'],
    ['text/html; charset=utf-8'],
    ['image/svg+xml'],
    ['application/xhtml+xml'],
    ['text/xml'],
    ['text/javascript'],
    ['application/atom+xml'],
    ['application/vnd.example+xml'],
    [''],
    ['not a mime'],
  ])('ブラウザが解釈しうる形式・不正な形式は octet-stream にする: %s', (type) => {
    expect(toStoredMimeType(type)).toBe(OCTET_STREAM_MIME)
  })
})

describe('saveContentFile', () => {
  it('変換せずに保存し、拡張子と正規化した形式で記録する', async () => {
    vi.mocked(prisma.attachment.create).mockImplementation(
      (async ({ data }: { data: { key: string; size: number } }) => data) as never,
    )
    const file = new File(['<p>hi</p>'], 'page.HTML', { type: 'text/html' })

    const saved = await saveContentFile(file, { boardId: 'b1', userId: 'u1' })

    expect(saved.key).toMatch(/\.html$/)
    expect(saved.url).toBe(toUploadUrl(saved.key))
    expect(putObject).toHaveBeenCalledWith(saved.key, expect.any(Uint8Array), OCTET_STREAM_MIME)
    expect(prisma.attachment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ mimeType: OCTET_STREAM_MIME, originalName: 'page.HTML', size: 9, boardId: 'b1' }),
    })
  })

  it('Wiki スペースを添付先にすると wikiSpaceId を記録し、ボードには紐付けない', async () => {
    vi.mocked(prisma.attachment.create).mockImplementation(
      (async ({ data }: { data: { key: string; size: number } }) => data) as never,
    )

    await saveContentFile(new File(['x'], 'spec.pdf'), { boardId: null, wikiSpaceId: 's1', userId: 'u1' })

    expect(prisma.attachment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ boardId: null, wikiSpaceId: 's1', createdById: 'u1' }),
    })
  })

  it('添付先を指定しなければ wikiSpaceId は null', async () => {
    vi.mocked(prisma.attachment.create).mockImplementation(
      (async ({ data }: { data: { key: string; size: number } }) => data) as never,
    )

    await saveContentFile(new File(['x'], 'a.txt'), { boardId: 'b1', userId: 'u1' })

    expect(prisma.attachment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ boardId: 'b1', wikiSpaceId: null }),
    })
  })

  it('長すぎるファイル名は拡張子の側を残して切る', async () => {
    vi.mocked(prisma.attachment.create).mockImplementation(
      (async ({ data }: { data: { key: string; size: number } }) => data) as never,
    )
    const name = `${'あ'.repeat(300)}.txt`

    await saveContentFile(new File(['x'], name), { boardId: null, userId: 'u1' })

    const { data } = vi.mocked(prisma.attachment.create).mock.calls[0]?.[0] as { data: { originalName: string } }
    expect([...data.originalName]).toHaveLength(200)
    expect(data.originalName.endsWith('あ.txt')).toBe(true)
  })

  it('記録に失敗したら保存した実体を消す', async () => {
    vi.mocked(prisma.attachment.create).mockRejectedValue(new Error('db down'))
    vi.mocked(deleteObject).mockResolvedValue(undefined as never)

    await expect(saveContentFile(new File(['x'], 'a.txt'), { boardId: null, userId: 'u1' })).rejects.toThrow('db down')
    expect(deleteObject).toHaveBeenCalledWith(expect.stringMatching(/\.txt$/))
  })
})

describe('listContentAttachments', () => {
  const row = (key: string) => ({ key, originalName: key, size: 1, mimeType: 'text/plain', createdAt: new Date() })

  it('本文での登場順に並べ、見つからないキーは除く(他ボード・Wiki スペースの添付は条件で除く)', async () => {
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([row('b'), row('a')] as never)

    const list = await listContentAttachments(['a', 'x', 'b'], 'board1')

    expect(list.map((item) => item.key)).toEqual(['a', 'b'])
    expect(prisma.attachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: { in: ['a', 'x', 'b'] }, OR: [{ boardId: 'board1' }, { boardId: null, wikiSpaceId: null }] },
      }),
    )
  })

  it('キーが無ければ DB を引かない', async () => {
    expect(await listContentAttachments([], 'board1')).toEqual([])
    expect(prisma.attachment.findMany).not.toHaveBeenCalled()
  })
})
