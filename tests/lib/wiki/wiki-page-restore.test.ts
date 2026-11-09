/**
 * Wiki ページの版の復元(wiki-page.ts の restoreWikiPageRevision)
 *
 * 存在するページは本文系だけを戻して位置を変えないこと、削除済みのページは親の有無で戻す先が変わること、
 * どちらも restored の版を残すことを、prisma を差し替えて確かめる。
 */

import { prisma } from '@/lib/prisma'
import { assertWikiSpaceAccess } from '@/lib/wiki/wiki-access'
import { restoreWikiPageRevision } from '@/lib/wiki/wiki-page'
import { writeWikiPageRevision } from '@/lib/wiki/wiki-revision'
import { MAX_WIKI_DEPTH, type WikiWriter } from '@/lib/wiki/wiki-rule'
import { findWikiTagsByNames, syncWikiPageTags } from '@/lib/wiki/wiki-tag'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    wikiPage: ['findUnique', 'findMany', 'create', 'update'],
    wikiPageRevision: ['findUnique'],
  }),
)
vi.mock('@/lib/wiki/wiki-access', () => ({ assertWikiSpaceAccess: vi.fn() }))
vi.mock('@/lib/wiki/wiki-revision', () => ({ writeWikiPageRevision: vi.fn() }))
vi.mock('@/lib/wiki/wiki-space', () => ({ getWikiSpaceByKey: vi.fn() }))
vi.mock('@/lib/board/board-access', () => ({ getTicketAccess: vi.fn() }))
vi.mock('@/lib/wiki/wiki-tag', () => ({
  assertWikiTagIdsInSpace: vi.fn(),
  findWikiTagsByNames: vi.fn(),
  syncWikiPageTags: vi.fn(),
}))

const actor = { id: 'u1' }
const WEB: WikiWriter = { via: 'web' }
const SPACE_ID = 's1'
const UPDATED_AT = new Date('2026-11-01T00:00:00.000Z')

/** スペースに残っているタグ(「廃止」は消えている) */
const TAGS = [
  { id: 'tag-a', name: '設計' },
  { id: 'tag-b', name: '運用' },
]

type Row = { id: string; parentId: string | null; order: number }

/**
 * a ─ b
 *   └ d
 * e
 */
const TREE: Row[] = [
  { id: 'a', parentId: null, order: 0 },
  { id: 'e', parentId: null, order: 1 },
  { id: 'b', parentId: 'a', order: 0 },
  { id: 'd', parentId: 'a', order: 1 },
]

/** 戻し元の版。既定は削除済みのページ x(親 a の 1 番目)の内容 */
const revision = (override: Record<string, unknown> = {}) => ({
  spaceId: SPACE_ID,
  pageId: 'x',
  pageNumber: 7,
  parentId: 'a',
  order: 1,
  title: '戻すタイトル',
  content: '戻す本文',
  tagNames: ['設計', '廃止'],
  ...override,
})

/** 存在するページ x。位置は e の下 */
const existingPage = (override: Record<string, unknown> = {}) => ({
  parentId: 'e',
  order: 0,
  title: 'いまのタイトル',
  content: 'いまの本文',
  tags: [{ tag: { id: 'tag-b', name: '運用' } }],
  updatedAt: UPDATED_AT,
  ...override,
})

let tree: Row[] = TREE

/** 兄弟の並びの振り直し($executeRaw の VALUES)を [id, order] の列で取り出す */
const orderUpdates = () =>
  vi.mocked(prisma.$executeRaw).mock.calls.flatMap(([, ...values]) =>
    values.flatMap((value) => {
      const flat = (value as { values?: unknown[] }).values ?? []
      return Array.from({ length: flat.length / 2 }, (_, i) => [flat[i * 2], flat[i * 2 + 1]])
    }),
  )

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
  tree = TREE
  vi.mocked(assertWikiSpaceAccess).mockResolvedValue({ key: 'DOCS' } as never)
  vi.mocked(prisma.wikiPageRevision.findUnique).mockResolvedValue(revision() as never)
  vi.mocked(prisma.wikiPage.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.wikiPage.findMany).mockImplementation((async () => tree) as never)
  vi.mocked(prisma.wikiPage.update).mockResolvedValue({ updatedAt: new Date() } as never)
  vi.mocked(prisma.wikiPage.create).mockResolvedValue({ updatedAt: new Date() } as never)
  vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
  vi.mocked(findWikiTagsByNames).mockImplementation(async (_tx, _spaceId, names) =>
    TAGS.filter(({ name }) => names.includes(name)),
  )
})

describe('restoreWikiPageRevision(ページが存在する)', () => {
  beforeEach(() => {
    vi.mocked(prisma.wikiPage.findUnique).mockResolvedValue(existingPage() as never)
  })

  it('タイトル・本文・タグを版の内容に戻し、restored の版を残す。位置は変えない', async () => {
    const result = await restoreWikiPageRevision(actor, WEB, 'rev-1')

    expect(result).toMatchObject({ result: 'updated', id: 'x', ref: 'DOCS/7', number: 7 })
    expect(assertWikiSpaceAccess).toHaveBeenCalledWith(actor, SPACE_ID, 'write', expect.anything())
    const data = vi.mocked(prisma.wikiPage.update).mock.calls[0][0].data
    expect(data).toMatchObject({ title: '戻すタイトル', content: '戻す本文', updatedById: 'u1', updatedVia: 'web' })
    expect(data, '親・並びは変えない').not.toHaveProperty('parentId')
    expect(data).not.toHaveProperty('order')
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
    expect(syncWikiPageTags, '消えたタグは外す').toHaveBeenCalledWith(expect.anything(), 'x', ['tag-b'], ['tag-a'])
    expect(writeWikiPageRevision).toHaveBeenCalledWith(expect.anything(), {
      spaceId: SPACE_ID,
      pageId: 'x',
      pageNumber: 7,
      action: 'restored',
      snapshot: { parentId: 'e', order: 0, title: '戻すタイトル', content: '戻す本文', tagNames: ['設計'] },
      actorId: 'u1',
      via: 'web',
      restoredFromId: 'rev-1',
    })
  })

  it('いまの内容と同じなら何も書かない', async () => {
    vi.mocked(prisma.wikiPage.findUnique).mockResolvedValue(
      existingPage({
        title: '戻すタイトル',
        content: '戻す本文',
        tags: [{ tag: { id: 'tag-a', name: '設計' } }],
      }) as never,
    )

    const result = await restoreWikiPageRevision(actor, WEB, 'rev-1')

    expect(result).toMatchObject({ result: 'unchanged', updatedAt: UPDATED_AT })
    expect(prisma.wikiPage.update).not.toHaveBeenCalled()
    expect(writeWikiPageRevision).not.toHaveBeenCalled()
  })

  it('タグが同じならタグは付け直さない', async () => {
    vi.mocked(prisma.wikiPage.findUnique).mockResolvedValue(
      existingPage({ tags: [{ tag: { id: 'tag-a', name: '設計' } }] }) as never,
    )
    await restoreWikiPageRevision(actor, WEB, 'rev-1')
    expect(syncWikiPageTags).not.toHaveBeenCalled()
  })
})

describe('restoreWikiPageRevision(削除済みのページ)', () => {
  it('親が残っていれば、同じ id・番号でその下の元の位置に作り直す', async () => {
    const result = await restoreWikiPageRevision(actor, WEB, 'rev-1')

    expect(result).toMatchObject({ result: 'created', id: 'x', ref: 'DOCS/7', number: 7 })
    expect(vi.mocked(prisma.wikiPage.create).mock.calls[0][0].data).toMatchObject({
      id: 'x',
      spaceId: SPACE_ID,
      number: 7,
      parentId: 'a',
      order: 1,
      title: '戻すタイトル',
      content: '戻す本文',
    })
    expect(orderUpdates(), 'd を後ろへずらす').toEqual([['d', 2]])
    expect(syncWikiPageTags).toHaveBeenCalledWith(expect.anything(), 'x', [], ['tag-a'])
    expect(vi.mocked(writeWikiPageRevision).mock.calls[0][1]).toMatchObject({
      action: 'restored',
      restoredFromId: 'rev-1',
      snapshot: { parentId: 'a', order: 1, tagNames: ['設計'] },
    })
  })

  it('親が無ければスペース直下の末尾に戻す', async () => {
    vi.mocked(prisma.wikiPageRevision.findUnique).mockResolvedValue(revision({ parentId: 'gone', order: 0 }) as never)

    await restoreWikiPageRevision(actor, WEB, 'rev-1')

    expect(vi.mocked(prisma.wikiPage.create).mock.calls[0][0].data).toMatchObject({ parentId: null, order: 2 })
    expect(orderUpdates()).toEqual([])
  })

  it('元の親の下では深さの上限を超えるなら、スペース直下に戻す', async () => {
    tree = Array.from({ length: MAX_WIKI_DEPTH }, (_, i) => ({
      id: `p${i + 1}`,
      parentId: i === 0 ? null : `p${i}`,
      order: 0,
    }))
    vi.mocked(prisma.wikiPageRevision.findUnique).mockResolvedValue(
      revision({ parentId: `p${MAX_WIKI_DEPTH}`, order: 0 }) as never,
    )

    await restoreWikiPageRevision(actor, WEB, 'rev-1')

    expect(vi.mocked(prisma.wikiPage.create).mock.calls[0][0].data).toMatchObject({ parentId: null, order: 1 })
  })
})

describe('restoreWikiPageRevision(拒否)', () => {
  it('版が無ければ(掃除済み)エラー', async () => {
    vi.mocked(prisma.wikiPageRevision.findUnique).mockResolvedValue(null)
    expect(await errorTypeOf(restoreWikiPageRevision(actor, WEB, 'rev-1'))).toBe('INVALID_OPERATION')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('書き込めない(閲覧者・アーカイブ済み)ならロックの後の権限判定で弾き、何も書かない', async () => {
    vi.mocked(assertWikiSpaceAccess).mockRejectedValue(Object.assign(new Error(), { errorType: 'INVALID_OPERATION' }))

    expect(await errorTypeOf(restoreWikiPageRevision(actor, WEB, 'rev-1'))).toBe('INVALID_OPERATION')
    expect(vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(assertWikiSpaceAccess).mock.invocationCallOrder[0],
    )
    expect(prisma.wikiPage.create).not.toHaveBeenCalled()
    expect(prisma.wikiPage.update).not.toHaveBeenCalled()
    expect(writeWikiPageRevision).not.toHaveBeenCalled()
  })
})
