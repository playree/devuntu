/**
 * Wiki のアナウンス用スペースの一覧とバックナンバー(wiki-announcement.ts)
 */

import { INVALID_OPERATION } from '@/lib/error'
import { prisma } from '@/lib/prisma'
import { assertWikiSpaceAccess } from '@/lib/wiki/wiki-access'
import {
  getWikiAnnouncementArchive,
  listRecentWikiAnnouncements,
  listWikiAnnouncements,
} from '@/lib/wiki/wiki-announcement'
import { MAX_WIKI_ANNOUNCEMENT_TREE } from '@/lib/wiki/wiki-announcement-rule'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    wikiPage: ['findMany', 'count'],
    wikiAnnouncementNotify: ['findMany'],
    user: ['findUnique'],
  }),
)
vi.mock('@/lib/wiki/wiki-access', () => ({ assertWikiSpaceAccess: vi.fn() }))

const actor = { id: 'u1' }
const SPACE_ID = 's1'
const CREATED_AT = new Date('2026-11-20T01:00:00.000Z')

const errorTypeOf = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (e) {
    return (e as { errorType?: string }).errorType
  }
  throw new Error('not rejected')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertWikiSpaceAccess).mockResolvedValue({ type: 'announcement' } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: '閲覧者', timezone: 'Asia/Tokyo' } as never)
  vi.mocked(prisma.wikiPage.findMany).mockResolvedValue([
    {
      id: 'p1',
      number: 3,
      title: 'お知らせ',
      createdAt: CREATED_AT,
      createdBy: { name: '作成者A' },
      tags: [{ tagId: 't1' }],
    },
  ] as never)
  vi.mocked(prisma.wikiPage.count).mockResolvedValue(25)
})

describe('listWikiAnnouncements', () => {
  it('閲覧の権限を確かめ、作成日時の新しい順で 1 ページ分と総件数を返す', async () => {
    const result = await listWikiAnnouncements(actor, SPACE_ID, { page: 3, rowsPerPage: 10 })

    expect(assertWikiSpaceAccess).toHaveBeenCalledWith(actor, SPACE_ID, 'view')
    expect(result).toEqual({
      items: [
        { id: 'p1', number: 3, title: 'お知らせ', createdAt: CREATED_AT, createdByName: '作成者A', tagIds: ['t1'] },
      ],
      total: 25,
    })
    expect(prisma.wikiPage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { spaceId: SPACE_ID },
        orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
        skip: 20,
        take: 10,
      }),
    )
    // 期間の指定が無ければタイムゾーンを引かない
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('Slack 通知の状態は editor 以上にだけ付ける(予約中を優先し、無ければ未通知)', async () => {
    vi.mocked(prisma.wikiPage.findMany).mockResolvedValue(
      ['p1', 'p2', 'p3'].map((id, i) => ({
        id,
        number: i + 1,
        title: id,
        createdAt: CREATED_AT,
        createdBy: null,
        tags: [],
      })) as never,
    )
    vi.mocked(prisma.wikiAnnouncementNotify.findMany).mockResolvedValue([
      { pageId: 'p1', status: 'sent' },
      { pageId: 'p1', status: 'scheduled' },
      { pageId: 'p2', status: 'sent' },
    ] as never)

    const viewer = await listWikiAnnouncements(actor, SPACE_ID, { page: 1, rowsPerPage: 10 })
    expect(viewer.items.every((item) => !('notifyState' in item))).toBe(true)
    expect(prisma.wikiAnnouncementNotify.findMany).not.toHaveBeenCalled()

    vi.mocked(assertWikiSpaceAccess).mockResolvedValue({ type: 'announcement', role: 'editor' } as never)
    const editor = await listWikiAnnouncements(actor, SPACE_ID, { page: 1, rowsPerPage: 10 })
    expect(editor.items.map(({ id, notifyState }) => [id, notifyState])).toEqual([
      ['p1', 'scheduled'],
      ['p2', 'sent'],
      ['p3', 'none'],
    ])
    expect(vi.mocked(prisma.wikiAnnouncementNotify.findMany).mock.calls[0][0]?.where).toEqual({
      pageId: { in: ['p1', 'p2', 'p3'] },
      status: { in: ['scheduled', 'sent'] },
    })
  })

  it('月とタグで絞り込む。月は閲覧者のタイムゾーンで区切る', async () => {
    await listWikiAnnouncements(actor, SPACE_ID, { month: '2026-11', tagId: 't1', page: 1, rowsPerPage: 10 })

    const where = {
      spaceId: SPACE_ID,
      createdAt: { gte: new Date('2026-10-31T15:00:00.000Z'), lt: new Date('2026-11-30T15:00:00.000Z') },
      tags: { some: { tagId: 't1' } },
    }
    expect(vi.mocked(prisma.wikiPage.findMany).mock.calls[0][0]?.where).toEqual(where)
    expect(vi.mocked(prisma.wikiPage.count).mock.calls[0][0]?.where).toEqual(where)
  })

  it('アナウンス用でないスペースでは引けない', async () => {
    vi.mocked(assertWikiSpaceAccess).mockResolvedValue({ type: 'mixed' } as never)
    expect(await errorTypeOf(listWikiAnnouncements(actor, SPACE_ID, { page: 1, rowsPerPage: 10 }))).toBe(
      INVALID_OPERATION,
    )
    expect(prisma.wikiPage.findMany).not.toHaveBeenCalled()
  })

  it('閲覧できなければ引かない', async () => {
    vi.mocked(assertWikiSpaceAccess).mockRejectedValue(new Error('denied'))
    await expect(listWikiAnnouncements(actor, SPACE_ID, { page: 1, rowsPerPage: 10 })).rejects.toThrow('denied')
    expect(prisma.wikiPage.findMany).not.toHaveBeenCalled()
  })
})

describe('getWikiAnnouncementArchive', () => {
  it('閲覧者のタイムゾーンで年月ごとに数える', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ month: '2026-11', count: 2 }] as never)

    expect(await getWikiAnnouncementArchive(actor, SPACE_ID)).toEqual([{ month: '2026-11', count: 2 }])
    expect(vi.mocked(prisma.$queryRaw).mock.calls[0].slice(1, 3)).toEqual(['Asia/Tokyo', SPACE_ID])
  })

  it('タグを渡すと、そのタグを持つアナウンスだけを数える', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
    await getWikiAnnouncementArchive(actor, SPACE_ID, { tagId: 't1' })
    expect(JSON.stringify(vi.mocked(prisma.$queryRaw).mock.calls[0])).toContain('t1')
  })

  it('タイムゾーンが未設定ならサーバーの既定で数える', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: '閲覧者', timezone: null } as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
    await getWikiAnnouncementArchive(actor, SPACE_ID)
    expect(vi.mocked(prisma.$queryRaw).mock.calls[0][1]).toBe('Asia/Tokyo')
  })

  it('アナウンス用でないスペースでは数えない', async () => {
    vi.mocked(assertWikiSpaceAccess).mockResolvedValue({ type: 'design_doc' } as never)
    expect(await errorTypeOf(getWikiAnnouncementArchive(actor, SPACE_ID))).toBe(INVALID_OPERATION)
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })
})

describe('listRecentWikiAnnouncements', () => {
  it('新しい順に上限まで、本文なしで返し、総件数を添える', async () => {
    vi.mocked(prisma.wikiPage.findMany).mockResolvedValue([
      { number: 3, title: 'お知らせ', createdAt: CREATED_AT, tags: [{ tagId: 't1' }] },
    ] as never)

    expect(await listRecentWikiAnnouncements(actor, SPACE_ID)).toEqual({
      items: [{ number: 3, title: 'お知らせ', createdAt: CREATED_AT, tagIds: ['t1'] }],
      total: 25,
    })
    expect(vi.mocked(prisma.wikiPage.findMany).mock.calls[0][0]).toMatchObject({
      orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
      take: MAX_WIKI_ANNOUNCEMENT_TREE,
    })
  })
})
