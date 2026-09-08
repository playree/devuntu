/**
 * 添付キーの参照元検索の単体テスト
 *
 * 「参照されている」の判断を誤ると実データを消してしまうので、
 * 5つの参照元それぞれを拾えること、本文のページ送りが取りこぼさないことを確認する。
 */

import { ATTACHMENT_SCAN_BATCH } from '@/lib/maintenance/maintenance'
import { prisma } from '@/lib/prisma'
import { collectReferencedUploadKeys, findAttachmentReference } from '@/lib/storage/attachment-ref'
import { toUploadUrl } from '@/lib/storage/upload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    ticket: { findMany: vi.fn(), findFirst: vi.fn() },
    ticketComment: { findMany: vi.fn(), findFirst: vi.fn() },
    user: { findMany: vi.fn(), findFirst: vi.fn() },
    linkWidget: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}))

const getString = vi.fn()
vi.mock('@/lib/kvs', () => ({ getString: (...args: unknown[]) => getString(...args) }))

const keyA = '019eef64-6cc1-78f1-8f50-1ef86986289a.webp'
const keyB = '019eef64-6cc1-78f1-8f50-1ef86986289b.webp'
const keyC = '019eef64-6cc1-78f1-8f50-1ef86986289c.webp'
const keyD = '019eef64-6cc1-78f1-8f50-1ef86986289d.webp'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.ticket.findMany).mockResolvedValue([])
  vi.mocked(prisma.ticketComment.findMany).mockResolvedValue([])
  vi.mocked(prisma.user.findMany).mockResolvedValue([])
  vi.mocked(prisma.linkWidget.findMany).mockResolvedValue([])
  for (const model of [prisma.ticket, prisma.ticketComment, prisma.user, prisma.linkWidget]) {
    vi.mocked(model.findFirst).mockResolvedValue(null)
  }
  getString.mockResolvedValue(null)
})

describe('collectReferencedUploadKeys', () => {
  it('本文・アバター・アイコン・お知らせのすべてから集める', async () => {
    vi.mocked(prisma.ticket.findMany).mockResolvedValue([{ id: 't1', content: `![](${toUploadUrl(keyA)})` }])
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ image: toUploadUrl(keyB) }])
    vi.mocked(prisma.linkWidget.findMany).mockResolvedValue([{ iconPath: toUploadUrl(keyC) }])
    getString.mockResolvedValue({ value: `お知らせ ${toUploadUrl(keyD)}` })

    const keys = await collectReferencedUploadKeys()

    expect([...keys].sort()).toEqual([keyA, keyB, keyC, keyD].sort())
  })

  it('1ページに収まらない本文はカーソルで続きを引く', async () => {
    const first = Array.from({ length: ATTACHMENT_SCAN_BATCH }, (_, i) => ({
      id: `t${String(i).padStart(4, '0')}`,
      content: i === 0 ? `![](${toUploadUrl(keyA)})` : '',
    }))
    vi.mocked(prisma.ticket.findMany)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce([{ id: 'zzz', content: `![](${toUploadUrl(keyB)})` }])

    const keys = await collectReferencedUploadKeys()

    const second = vi.mocked(prisma.ticket.findMany).mock.calls[1][0]
    expect(second?.cursor, '最終行から続ける').toEqual({ id: first[first.length - 1].id })
    expect(second?.skip, 'カーソル自身は含めない').toBe(1)
    expect(keys.has(keyA) && keys.has(keyB), '両ページのキーが揃う').toBe(true)
  })

  it('形式外のキーは集合に入れない(手打ちのURLで汚さない)', async () => {
    vi.mocked(prisma.ticket.findMany).mockResolvedValue([{ id: 't1', content: '![](/api/upload/not-a-uuid.webp)' }])
    expect((await collectReferencedUploadKeys()).size).toBe(0)
  })
})

describe('findAttachmentReference', () => {
  it('チケット本文の参照を見つける', async () => {
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue({ id: 't1' })
    expect(await findAttachmentReference(keyA)).toBe('ticket')
  })

  it('コメント本文の参照を見つける', async () => {
    vi.mocked(prisma.ticketComment.findFirst).mockResolvedValue({ id: 'c1' })
    expect(await findAttachmentReference(keyA)).toBe('comment')
  })

  it('アバターの参照を見つける', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'u1' })
    expect(await findAttachmentReference(keyA)).toBe('user')
  })

  it('リンクウィジェットのアイコンの参照を見つける', async () => {
    vi.mocked(prisma.linkWidget.findFirst).mockResolvedValue({ id: 'w1' })
    expect(await findAttachmentReference(keyA)).toBe('linkWidget')
  })

  it('お知らせ本文の参照を見つける', async () => {
    getString.mockResolvedValue({ value: `本文 ${toUploadUrl(keyA)}` })
    expect(await findAttachmentReference(keyA)).toBe('announcement')
  })

  it('どこからも参照されていなければ null', async () => {
    expect(await findAttachmentReference(keyA)).toBeNull()
  })

  it('別のキーのURLを含むお知らせでは参照とみなさない', async () => {
    getString.mockResolvedValue({ value: `本文 ${toUploadUrl(keyB)}` })
    expect(await findAttachmentReference(keyA)).toBeNull()
  })
})
