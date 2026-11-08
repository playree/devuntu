/**
 * Wiki ページの版の書き込み(wiki-revision.ts)
 *
 * 連続保存のまとめと、1ページあたりの上限を超えた分の削除を確かめる。
 */

import { prisma } from '@/lib/prisma'
import { writeWikiPageRevision, type WriteWikiPageRevision } from '@/lib/wiki/wiki-revision'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings = { merge: 10, max: 3 }

vi.mock('@/lib/env-util', () => ({
  envu: {
    server: {
      get WIKI_REVISION_MERGE_MINUTES() {
        return settings.merge
      },
      get WIKI_REVISION_MAX_PER_PAGE() {
        return settings.max
      },
    },
  },
}))

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    wikiPageRevision: ['findFirst', 'findMany', 'create', 'update', 'deleteMany'],
  }),
)

const NOW = new Date('2026-11-08T10:00:00.000Z')
const snapshot = { parentId: null, order: 0, title: 'タイトル', content: '本文', tagNames: [] }

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
  action: 'updated',
  actorId: 'u1',
  via: 'web',
  ticketId: null,
  createdAt: new Date('2026-11-08T09:55:00.000Z'),
  ...override,
})

beforeEach(() => {
  vi.clearAllMocks()
  settings.merge = 10
  settings.max = 3
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
  ])('%s なら新しい版を作る', async (_, last, next) => {
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue(last as never)

    expect(await writeWikiPageRevision(prisma, next, NOW)).toBe('created')
    expect(prisma.wikiPageRevision.update).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.wikiPageRevision.create).mock.calls[0][0].data).toMatchObject({
      pageId: 'p1',
      action: 'updated',
      actorId: 'u1',
      ticketId: null,
      ...snapshot,
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('updated 以外は最新の版を引かずに新しい版を作る', async () => {
    expect(await writeWikiPageRevision(prisma, revision({ action: 'moved' }), NOW)).toBe('created')
    expect(prisma.wikiPageRevision.findFirst).not.toHaveBeenCalled()
  })

  it('まとめる時間が 0 なら最新の版を引かない', async () => {
    settings.merge = 0
    expect(await writeWikiPageRevision(prisma, revision(), NOW)).toBe('created')
    expect(prisma.wikiPageRevision.findFirst).not.toHaveBeenCalled()
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
