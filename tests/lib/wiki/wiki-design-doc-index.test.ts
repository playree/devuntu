/**
 * 設計書スペースの設計書一覧の材料(wiki-design-doc-index.ts)
 */

import { prisma } from '@/lib/prisma'
import { assertWikiSpaceAccess } from '@/lib/wiki/wiki-access'
import { getWikiDesignDocIndex } from '@/lib/wiki/wiki-design-doc-index'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => (await import('../../helpers/prisma')).mockPrisma({ wikiPage: ['findMany'] }))
vi.mock('@/lib/wiki/wiki-access', () => ({ assertWikiSpaceAccess: vi.fn() }))

const actor = { id: 'u1' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getWikiDesignDocIndex', () => {
  it('閲覧の権限を確かめ、設計書だけを兄弟の並び順で引く', async () => {
    vi.mocked(prisma.wikiPage.findMany).mockResolvedValue([])

    await getWikiDesignDocIndex(actor, 's1')

    expect(assertWikiSpaceAccess).toHaveBeenCalledWith(actor, 's1', 'view')
    expect(vi.mocked(prisma.wikiPage.findMany).mock.calls[0][0]).toMatchObject({
      where: { spaceId: 's1', type: 'design_doc' },
      orderBy: [{ order: 'asc' }, { number: 'asc' }],
    })
  })

  it('本文は返さず、front matter だけを添える(無ければ空文字)', async () => {
    vi.mocked(prisma.wikiPage.findMany).mockResolvedValue([
      { id: 'p1', parentId: null, number: 1, title: '基本設計', content: '---\nversion: 1.0\n---\n\n# 概要' },
      { id: 'p2', parentId: 'p1', number: 2, title: '画面', content: '# 画面' },
    ] as never)

    expect(await getWikiDesignDocIndex(actor, 's1')).toEqual([
      { id: 'p1', parentId: null, number: 1, title: '基本設計', frontMatter: '---\nversion: 1.0\n---\n' },
      { id: 'p2', parentId: 'p1', number: 2, title: '画面', frontMatter: '' },
    ])
  })

  it('権限が無ければ引かない', async () => {
    vi.mocked(assertWikiSpaceAccess).mockRejectedValue(new Error('denied'))
    await expect(getWikiDesignDocIndex(actor, 's1')).rejects.toThrow('denied')
    expect(prisma.wikiPage.findMany).not.toHaveBeenCalled()
  })
})
