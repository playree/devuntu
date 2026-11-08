/**
 * Wiki のタグ(wiki-tag.ts)
 *
 * 作成・更新・削除の権限、件数の上限、重複名、別スペースのタグの付与を、prisma を差し替えて確かめる。
 */

import { DUPLICATED_TAG_NAME, MAX_TAGS_PER_SCOPE } from '@/lib/board/tag-rule'
import { INVALID_OPERATION, VALIDATION_ERROR } from '@/lib/error'
import { prisma } from '@/lib/prisma'
import { assertWikiSpaceAccess, getWikiSpaceAccess } from '@/lib/wiki/wiki-access'
import { MAX_WIKI_PAGE_TAGS } from '@/lib/wiki/wiki-rule'
import {
  assertWikiTagIdsInSpace,
  createWikiTag,
  deleteWikiTag,
  listWikiTagsForManage,
  syncWikiPageTags,
  updateWikiTag,
} from '@/lib/wiki/wiki-tag'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    wikiTag: ['findMany', 'findUnique', 'create', 'update', 'delete'],
    wikiPageTag: ['deleteMany', 'createMany'],
  }),
)
vi.mock('@/lib/wiki/wiki-access', () => ({ assertWikiSpaceAccess: vi.fn(), getWikiSpaceAccess: vi.fn() }))

const actor = { id: 'u1' }
const SPACE_ID = 's1'

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
  vi.mocked(assertWikiSpaceAccess).mockResolvedValue({} as never)
  vi.mocked(prisma.wikiTag.findMany).mockResolvedValue([])
  vi.mocked(prisma.wikiTag.findUnique).mockResolvedValue({ spaceId: SPACE_ID } as never)
  vi.mocked(prisma.wikiTag.create).mockImplementation((async ({ data }: { data: object }) => ({
    id: 'new',
    ...data,
  })) as never)
  vi.mocked(prisma.wikiTag.update).mockImplementation((async ({ data }: { data: object }) => ({
    id: 't1',
    ...data,
  })) as never)
})

describe('createWikiTag', () => {
  it('スペース行をロックしてから editor 以上かを確かめ、末尾の順で作る', async () => {
    vi.mocked(prisma.wikiTag.findMany).mockResolvedValue([{ order: 0 }, { order: 4 }] as never)

    const tag = await createWikiTag(actor, SPACE_ID, { name: '設計', color: 'blue' })

    expect(tag).toMatchObject({ name: '設計', color: 'blue', order: 5 })
    expect(assertWikiSpaceAccess).toHaveBeenCalledWith(actor, SPACE_ID, 'write', expect.anything())
    expect(vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(assertWikiSpaceAccess).mock.invocationCallOrder[0],
    )
  })

  it('スペースのタグが上限に達していれば作れない', async () => {
    vi.mocked(prisma.wikiTag.findMany).mockResolvedValue(
      Array.from({ length: MAX_TAGS_PER_SCOPE }, (_, order) => ({ order })) as never,
    )
    expect(await errorTypeOf(createWikiTag(actor, SPACE_ID, { name: '設計', color: 'blue' }))).toBe(INVALID_OPERATION)
    expect(prisma.wikiTag.create).not.toHaveBeenCalled()
  })

  it('同じスペースに同名があれば DUPLICATED_TAG_NAME', async () => {
    vi.mocked(prisma.wikiTag.create).mockRejectedValue({ code: 'P2002' })
    expect(await errorTypeOf(createWikiTag(actor, SPACE_ID, { name: '設計', color: 'blue' }))).toBe(DUPLICATED_TAG_NAME)
  })

  it('書き込めないスペースでは作れない', async () => {
    vi.mocked(assertWikiSpaceAccess).mockRejectedValue(new Error('denied'))
    await expect(createWikiTag(actor, SPACE_ID, { name: '設計', color: 'blue' })).rejects.toThrow('denied')
    expect(prisma.wikiTag.create).not.toHaveBeenCalled()
  })
})

describe('updateWikiTag / deleteWikiTag', () => {
  it('更新はタグのスペースで manage を要する', async () => {
    await updateWikiTag(actor, { id: 't1', name: '運用', color: 'green', order: 1 })
    expect(assertWikiSpaceAccess).toHaveBeenCalledWith(actor, SPACE_ID, 'manage')
    expect(prisma.wikiTag.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' }, data: { name: '運用', color: 'green', order: 1 } }),
    )
  })

  it('更新で同名になれば DUPLICATED_TAG_NAME', async () => {
    vi.mocked(prisma.wikiTag.update).mockRejectedValue({ code: 'P2002' })
    expect(await errorTypeOf(updateWikiTag(actor, { id: 't1', name: '運用', color: 'green', order: 1 }))).toBe(
      DUPLICATED_TAG_NAME,
    )
  })

  it('削除は manage を要し、無ければ消さない', async () => {
    vi.mocked(assertWikiSpaceAccess).mockRejectedValue(new Error('denied'))
    await expect(deleteWikiTag(actor, 't1')).rejects.toThrow('denied')
    expect(assertWikiSpaceAccess).toHaveBeenCalledWith(actor, SPACE_ID, 'manage', expect.anything())
    expect(prisma.wikiTag.delete).not.toHaveBeenCalled()
  })

  it('存在しないタグは INVALID_OPERATION', async () => {
    vi.mocked(prisma.wikiTag.findUnique).mockResolvedValue(null)
    expect(await errorTypeOf(updateWikiTag(actor, { id: 'x', name: 'a', color: 'gray', order: 0 }))).toBe(
      INVALID_OPERATION,
    )
    expect(await errorTypeOf(deleteWikiTag(actor, 'x'))).toBe(INVALID_OPERATION)
  })
})

describe('listWikiTagsForManage', () => {
  it('付与しているページ数を usageCount として返す', async () => {
    vi.mocked(getWikiSpaceAccess).mockResolvedValue({ canView: true, canManage: false } as never)
    vi.mocked(prisma.wikiTag.findMany).mockResolvedValue([
      { id: 't1', name: '設計', color: 'blue', order: 0, _count: { pages: 3 } },
    ] as never)
    expect(await listWikiTagsForManage(actor, SPACE_ID)).toEqual([
      { id: 't1', name: '設計', color: 'blue', order: 0, usageCount: 3 },
    ])
  })

  it('割り当ての無い管理者(管理だけできる)も読める', async () => {
    vi.mocked(getWikiSpaceAccess).mockResolvedValue({ canView: false, canManage: true } as never)
    await expect(listWikiTagsForManage(actor, SPACE_ID)).resolves.toEqual([])
  })

  it('閲覧も管理もできなければ INVALID_OPERATION', async () => {
    vi.mocked(getWikiSpaceAccess).mockResolvedValue({ canView: false, canManage: false } as never)
    expect(await errorTypeOf(listWikiTagsForManage(actor, SPACE_ID))).toBe(INVALID_OPERATION)
    vi.mocked(getWikiSpaceAccess).mockResolvedValue(null)
    expect(await errorTypeOf(listWikiTagsForManage(actor, SPACE_ID))).toBe(INVALID_OPERATION)
  })
})

describe('assertWikiTagIdsInSpace', () => {
  it('重複を除き、そのスペースのタグだけで引いて表示順で返す', async () => {
    vi.mocked(prisma.wikiTag.findMany).mockResolvedValue([
      { id: 'b', name: '運用' },
      { id: 'a', name: '設計' },
    ] as never)
    expect(await assertWikiTagIdsInSpace(prisma, SPACE_ID, ['a', 'b', 'a'])).toEqual([
      { id: 'b', name: '運用' },
      { id: 'a', name: '設計' },
    ])
    expect(vi.mocked(prisma.wikiTag.findMany).mock.calls[0][0]?.where).toEqual({
      id: { in: ['a', 'b'] },
      spaceId: SPACE_ID,
    })
  })

  it('別のスペースのタグ(見つからない ID)が混ざれば INVALID_OPERATION', async () => {
    vi.mocked(prisma.wikiTag.findMany).mockResolvedValue([{ id: 'a', name: '設計' }] as never)
    expect(await errorTypeOf(assertWikiTagIdsInSpace(prisma, SPACE_ID, ['a', 'other']))).toBe(INVALID_OPERATION)
  })

  it('1ページの上限を超えれば検証エラー', async () => {
    const ids = Array.from({ length: MAX_WIKI_PAGE_TAGS + 1 }, (_, i) => `t${i}`)
    expect(await errorTypeOf(assertWikiTagIdsInSpace(prisma, SPACE_ID, ids))).toBe(VALIDATION_ERROR)
    expect(prisma.wikiTag.findMany).not.toHaveBeenCalled()
  })

  it('空なら引かない', async () => {
    expect(await assertWikiTagIdsInSpace(prisma, SPACE_ID, [])).toEqual([])
    expect(prisma.wikiTag.findMany).not.toHaveBeenCalled()
  })
})

describe('syncWikiPageTags', () => {
  it('外れたタグだけを消し、増えたタグだけを足す', async () => {
    await syncWikiPageTags(prisma as never, 'p1', ['a', 'b'], ['b', 'c'])
    expect(prisma.wikiPageTag.deleteMany).toHaveBeenCalledWith({ where: { pageId: 'p1', tagId: { in: ['a'] } } })
    expect(prisma.wikiPageTag.createMany).toHaveBeenCalledWith({
      data: [{ pageId: 'p1', tagId: 'c' }],
      skipDuplicates: true,
    })
  })

  it('変化が無ければ書かない', async () => {
    await syncWikiPageTags(prisma as never, 'p1', ['a'], ['a'])
    expect(prisma.wikiPageTag.deleteMany).not.toHaveBeenCalled()
    expect(prisma.wikiPageTag.createMany).not.toHaveBeenCalled()
  })
})
