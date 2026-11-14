/**
 * Wiki ページの版の書き込み(wiki-revision.ts)
 *
 * 連続保存のまとめと、1ページあたりの上限を超えた分の削除、版の一覧・本文・削除済みページの参照、版の削除を確かめる。
 */

import { prisma } from '@/lib/prisma'
import { assertWikiSpaceAccess } from '@/lib/wiki/wiki-access'
import {
  deleteWikiPageRevision,
  getWikiPageRevisionContent,
  listDeletedWikiPages,
  listWikiPageRevisions,
  writeWikiPageRevision,
  type WriteWikiPageRevision,
} from '@/lib/wiki/wiki-revision'
import type { WikiPageSnapshot } from '@/lib/wiki/wiki-rule'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings = { merge: 10, max: 3, retention: 7 }

vi.mock('@/lib/env-util', () => ({
  envu: {
    server: {
      get WIKI_REVISION_MERGE_MINUTES() {
        return settings.merge
      },
      get WIKI_REVISION_MAX_PER_PAGE() {
        return settings.max
      },
      get WIKI_REVISION_RETENTION_DAYS() {
        return settings.retention
      },
    },
  },
}))

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    wikiPageRevision: ['findFirst', 'findUnique', 'findMany', 'create', 'update', 'deleteMany'],
    wikiPage: ['findUnique', 'findMany'],
  }),
)
vi.mock('@/lib/wiki/wiki-access', () => ({ assertWikiSpaceAccess: vi.fn() }))

const NOW = new Date('2026-11-08T10:00:00.000Z')
const snapshot: WikiPageSnapshot = {
  parentId: null,
  order: 0,
  title: 'タイトル',
  content: '本文',
  type: 'page',
  tagNames: [],
}

const revision = (override: Partial<WriteWikiPageRevision> = {}): WriteWikiPageRevision => ({
  spaceId: 's1',
  pageId: 'p1',
  pageNumber: 1,
  action: 'updated',
  snapshot,
  actorId: 'u1',
  via: 'web',
  ...override,
})

/** 最新の版。既定は今回と同じ人・経路で 5 分前の updated(まとめる対象) */
const latest = (override: Record<string, unknown> = {}) => ({
  id: 'r-latest',
  number: 4,
  action: 'updated',
  actorId: 'u1',
  via: 'web',
  ticketId: null,
  message: null,
  createdAt: new Date('2026-11-08T09:55:00.000Z'),
  ...override,
})

beforeEach(() => {
  vi.clearAllMocks()
  settings.merge = 10
  settings.max = 3
  settings.retention = 7
  vi.mocked(assertWikiSpaceAccess).mockResolvedValue({ key: 'DOCS' } as never)
  vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.wikiPageRevision.findMany).mockResolvedValue([])
})

describe('writeWikiPageRevision: 連続保存のまとめ', () => {
  it('条件を満たせば最新の版を上書きし、updatedAt を進める', async () => {
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue(latest() as never)

    expect(await writeWikiPageRevision(prisma, revision(), NOW)).toBe('merged')
    expect(prisma.wikiPageRevision.update).toHaveBeenCalledWith({
      where: { id: 'r-latest' },
      data: { ...snapshot, updatedAt: NOW },
    })
    expect(prisma.wikiPageRevision.create).not.toHaveBeenCalled()
  })

  it.each([
    ['時間を過ぎている', latest({ createdAt: new Date('2026-11-08T09:49:00.000Z') }), revision()],
    ['別の人', latest({ actorId: 'u2' }), revision()],
    ['別の経路', latest({ via: 'mcp' }), revision()],
    ['別のチケット', latest({ ticketId: 't1' }), revision()],
    ['最新の版が created', latest({ action: 'created' }), revision()],
    ['最新の版にコミットメッセージがある', latest({ message: '見出しを整理' }), revision()],
  ])('%s なら新しい版を作る', async (_, last, next) => {
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue(last as never)

    expect(await writeWikiPageRevision(prisma, next, NOW)).toBe('created')
    expect(prisma.wikiPageRevision.update).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.wikiPageRevision.create).mock.calls[0][0].data).toMatchObject({
      pageId: 'p1',
      number: 5,
      action: 'updated',
      actorId: 'u1',
      ticketId: null,
      ...snapshot,
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('コミットメッセージ付きの保存はまとめず、新しい版にメッセージを残す', async () => {
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue(latest() as never)

    expect(await writeWikiPageRevision(prisma, revision({ message: '見出しを整理' }), NOW)).toBe('created')
    expect(prisma.wikiPageRevision.update).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.wikiPageRevision.create).mock.calls[0][0].data).toMatchObject({
      number: 5,
      message: '見出しを整理',
    })
  })

  it('updated 以外はまとめずに新しい版を作る', async () => {
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue(latest() as never)
    expect(await writeWikiPageRevision(prisma, revision({ action: 'moved' }), NOW)).toBe('created')
    expect(prisma.wikiPageRevision.update).not.toHaveBeenCalled()
  })

  it('まとめる時間が 0 ならまとめない', async () => {
    settings.merge = 0
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue(latest() as never)
    expect(await writeWikiPageRevision(prisma, revision(), NOW)).toBe('created')
    expect(prisma.wikiPageRevision.update).not.toHaveBeenCalled()
  })
})

describe('writeWikiPageRevision: 版の番号', () => {
  it('版が無ければ 1 から振る', async () => {
    await writeWikiPageRevision(prisma, revision({ action: 'created' }), NOW)
    expect(vi.mocked(prisma.wikiPageRevision.create).mock.calls[0][0].data).toMatchObject({ number: 1 })
  })

  it('updated 以外でも最新の版の番号に続ける', async () => {
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue(latest({ number: 7 }) as never)
    await writeWikiPageRevision(prisma, revision({ action: 'moved' }), NOW)
    expect(vi.mocked(prisma.wikiPageRevision.findFirst).mock.calls[0][0]).toMatchObject({
      where: { pageId: 'p1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    expect(vi.mocked(prisma.wikiPageRevision.create).mock.calls[0][0].data).toMatchObject({ number: 8 })
  })

  it('まとめたときは番号を変えない', async () => {
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue(latest() as never)
    await writeWikiPageRevision(prisma, revision(), NOW)
    expect(vi.mocked(prisma.wikiPageRevision.update).mock.calls[0][0].data).not.toHaveProperty('number')
  })
})

describe('writeWikiPageRevision: 件数の上限', () => {
  it('上限を超えた古い版を消す', async () => {
    vi.mocked(prisma.wikiPageRevision.findMany).mockResolvedValue([{ id: 'r-old1' }, { id: 'r-old2' }] as never)

    await writeWikiPageRevision(prisma, revision({ action: 'created' }), NOW)

    expect(vi.mocked(prisma.wikiPageRevision.findMany).mock.calls[0][0]).toMatchObject({
      where: { pageId: 'p1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 3,
    })
    expect(prisma.wikiPageRevision.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['r-old1', 'r-old2'] } } })
  })

  it('上限内なら消さない', async () => {
    await writeWikiPageRevision(prisma, revision({ action: 'created' }), NOW)
    expect(prisma.wikiPageRevision.deleteMany).not.toHaveBeenCalled()
  })

  it('まとめたときは件数が増えないので数えない', async () => {
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue(latest() as never)
    await writeWikiPageRevision(prisma, revision(), NOW)
    expect(prisma.wikiPageRevision.findMany).not.toHaveBeenCalled()
  })
})

/** 一覧の行(本文なし)。`updatedAt` は NOW からの日数で指定する */
const summaryRow = (id: string, daysAgo: number, override: Record<string, unknown> = {}) => ({
  id,
  pageId: 'p1',
  pageNumber: 1,
  number: 1,
  action: 'updated',
  parentId: null,
  title: 'タイトル',
  tagNames: [],
  via: 'web',
  restoredFromId: null,
  createdAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
  updatedAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
  actor: { name: '利用者', isAgent: false },
  ticket: null,
  ...override,
})

describe('listWikiPageRevisions', () => {
  it('存在するページのスペースで閲覧権限を確かめ、本文なしで新しい順に返す', async () => {
    const pageUpdatedAt = new Date('2026-11-08T09:00:00.000Z')
    vi.mocked(prisma.wikiPage.findUnique)
      .mockResolvedValueOnce({ spaceId: 's1' } as never)
      .mockResolvedValueOnce({ updatedAt: pageUpdatedAt } as never)
    vi.mocked(prisma.wikiPageRevision.findMany).mockResolvedValue([
      summaryRow('r2', 1, { ticket: { number: 5, board: { key: 'DEV' } } }),
      summaryRow('r1', 8, { actor: null }),
    ] as never)

    const { revisions: list, pageUpdatedAt: at } = await listWikiPageRevisions({ id: 'u1' }, 'p1', NOW)

    expect(assertWikiSpaceAccess).toHaveBeenCalledWith({ id: 'u1' }, 's1', 'view')
    const args = vi.mocked(prisma.wikiPageRevision.findMany).mock.calls[0][0]
    expect(args).toMatchObject({ where: { pageId: 'p1' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
    expect(args?.select).not.toHaveProperty('content')
    expect(list.map(({ id, beforeRetention }) => [id, beforeRetention])).toEqual([
      ['r2', false],
      ['r1', true],
    ])
    expect(list[0]).toMatchObject({ ticketDisplayId: 'DEV-5', actorName: '利用者' })
    expect(list[1]).toMatchObject({ ticketDisplayId: null, actorName: '', actorIsAgent: false })
    expect(at).toEqual(pageUpdatedAt)
  })

  it('ページの更新日時は版の一覧と同じスナップショットで読む', async () => {
    vi.mocked(prisma.wikiPage.findUnique).mockResolvedValue({ spaceId: 's1' } as never)
    vi.mocked(prisma.wikiPageRevision.findMany).mockResolvedValue([] as never)
    await listWikiPageRevisions({ id: 'u1' }, 'p1', NOW)
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Array), { isolationLevel: 'RepeatableRead' })
    expect(prisma.wikiPage.findUnique).toHaveBeenLastCalledWith({ where: { id: 'p1' }, select: { updatedAt: true } })
  })

  it('保持期間は WIKI_REVISION_RETENTION_DAYS に従う', async () => {
    settings.retention = 30
    vi.mocked(prisma.wikiPage.findUnique).mockResolvedValue({ spaceId: 's1' } as never)
    vi.mocked(prisma.wikiPageRevision.findMany).mockResolvedValue([summaryRow('r1', 8)] as never)
    expect((await listWikiPageRevisions({ id: 'u1' }, 'p1', NOW)).revisions[0].beforeRetention).toBe(false)
  })

  it('削除済みのページは版からスペースを引き、ページの更新日時は null', async () => {
    vi.mocked(prisma.wikiPage.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue({ spaceId: 's2' } as never)
    vi.mocked(prisma.wikiPageRevision.findMany).mockResolvedValue([] as never)
    expect((await listWikiPageRevisions({ id: 'u1' }, 'p1', NOW)).pageUpdatedAt).toBeNull()
    expect(assertWikiSpaceAccess).toHaveBeenCalledWith({ id: 'u1' }, 's2', 'view')
  })

  it('ページも版も無ければエラー', async () => {
    vi.mocked(prisma.wikiPage.findUnique).mockResolvedValue(null)
    await expect(listWikiPageRevisions({ id: 'u1' }, 'p1', NOW)).rejects.toMatchObject({
      errorType: 'INVALID_OPERATION',
    })
  })
})

describe('getWikiPageRevisionContent', () => {
  it('閲覧権限を確かめて版の本文を返す', async () => {
    vi.mocked(prisma.wikiPageRevision.findUnique).mockResolvedValue({ spaceId: 's1', content: '本文' } as never)

    expect(await getWikiPageRevisionContent({ id: 'u1' }, 'r2')).toBe('本文')
    expect(assertWikiSpaceAccess).toHaveBeenCalledWith({ id: 'u1' }, 's1', 'view')
  })

  it('版が無ければエラー', async () => {
    vi.mocked(prisma.wikiPageRevision.findUnique).mockResolvedValue(null)
    await expect(getWikiPageRevisionContent({ id: 'u1' }, 'r2')).rejects.toThrow()
    expect(assertWikiSpaceAccess).not.toHaveBeenCalled()
  })
})

describe('deleteWikiPageRevision', () => {
  const found = () =>
    vi
      .mocked(prisma.wikiPageRevision.findUnique)
      .mockResolvedValueOnce({ spaceId: 's1' } as never)
      .mockResolvedValueOnce({ pageId: 'p1' } as never)

  it('書き込み権限を確かめ、最新でない版を消す', async () => {
    found()
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue({ id: 'r-latest' } as never)

    await deleteWikiPageRevision({ id: 'u1' }, 'r2')
    expect(prisma.$queryRaw).toHaveBeenCalled()
    expect(assertWikiSpaceAccess).toHaveBeenCalledWith({ id: 'u1' }, 's1', 'write', prisma)
    expect(vi.mocked(prisma.wikiPageRevision.findFirst).mock.calls[0][0]).toMatchObject({
      where: { pageId: 'p1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    expect(prisma.wikiPageRevision.deleteMany).toHaveBeenCalledWith({ where: { id: 'r2' } })
  })

  it('最新の版は消せない', async () => {
    found()
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue({ id: 'r2' } as never)

    await expect(deleteWikiPageRevision({ id: 'u1' }, 'r2')).rejects.toThrow()
    expect(prisma.wikiPageRevision.deleteMany).not.toHaveBeenCalled()
  })

  it('書き込み権限が無ければ消さない', async () => {
    vi.mocked(prisma.wikiPageRevision.findUnique).mockResolvedValueOnce({ spaceId: 's1' } as never)
    vi.mocked(assertWikiSpaceAccess).mockRejectedValueOnce(new Error('forbidden'))

    await expect(deleteWikiPageRevision({ id: 'u1' }, 'r2')).rejects.toThrow('forbidden')
    expect(prisma.wikiPageRevision.deleteMany).not.toHaveBeenCalled()
  })

  it('ロックを取った後に版が消えていれば何もしない', async () => {
    vi.mocked(prisma.wikiPageRevision.findUnique)
      .mockResolvedValueOnce({ spaceId: 's1' } as never)
      .mockResolvedValueOnce(null)

    await deleteWikiPageRevision({ id: 'u1' }, 'r2')
    expect(prisma.wikiPageRevision.deleteMany).not.toHaveBeenCalled()
  })

  it('版が無ければエラー', async () => {
    vi.mocked(prisma.wikiPageRevision.findUnique).mockResolvedValue(null)
    await expect(deleteWikiPageRevision({ id: 'u1' }, 'r2')).rejects.toThrow()
    expect(assertWikiSpaceAccess).not.toHaveBeenCalled()
  })
})

describe('listDeletedWikiPages', () => {
  it('ページごとに最後の削除の版を引き、いま存在するページを除く', async () => {
    vi.mocked(prisma.wikiPageRevision.findMany).mockResolvedValue([
      summaryRow('r-gone', 1, { pageId: 'gone', pageNumber: 3, action: 'deleted' }),
      summaryRow('r-back', 2, { pageId: 'back', pageNumber: 4, action: 'deleted' }),
    ] as never)
    vi.mocked(prisma.wikiPage.findMany).mockResolvedValue([{ id: 'back' }] as never)

    const list = await listDeletedWikiPages({ id: 'u1' }, 's1', NOW)

    expect(assertWikiSpaceAccess).toHaveBeenCalledWith({ id: 'u1' }, 's1', 'view')
    expect(vi.mocked(prisma.wikiPageRevision.findMany).mock.calls[0][0]).toMatchObject({
      where: { spaceId: 's1', action: 'deleted' },
      distinct: ['pageId'],
    })
    expect(list.map(({ id, ref }) => [id, ref])).toEqual([['r-gone', 'DOCS/3']])
  })

  it('削除の版が無ければページを引かない', async () => {
    expect(await listDeletedWikiPages({ id: 'u1' }, 's1', NOW)).toEqual([])
    expect(prisma.wikiPage.findMany).not.toHaveBeenCalled()
  })
})
