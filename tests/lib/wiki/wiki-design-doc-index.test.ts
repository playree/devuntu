/**
 * 設計書スペースの設計書一覧の材料(wiki-design-doc-index.ts)
 */

import { prisma } from '@/lib/prisma'
import { assertWikiSpaceAccess } from '@/lib/wiki/wiki-access'
import { DESIGN_DOC_INDEX_HEAD, getWikiDesignDocIndex } from '@/lib/wiki/wiki-design-doc-index'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => (await import('../../helpers/prisma')).mockPrisma({ wikiPage: ['findMany'] }))
vi.mock('@/lib/wiki/wiki-access', () => ({ assertWikiSpaceAccess: vi.fn() }))

const actor = { id: 'u1' }

/** DB が返す行。content の先頭 DESIGN_DOC_INDEX_HEAD 文字を head にし、それより長ければ truncated にする */
const row = (id: string, content: string, parentId: string | null = null) => ({
  id,
  parentId,
  number: Number(id.slice(1)),
  title: id,
  head: content.slice(0, DESIGN_DOC_INDEX_HEAD),
  truncated: content.length > DESIGN_DOC_INDEX_HEAD,
})

const filler = (length: number) => 'x'.repeat(length)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getWikiDesignDocIndex', () => {
  it('閲覧の権限を確かめ、設計書だけを兄弟の並び順で、本文は先頭だけを引く', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([])

    await getWikiDesignDocIndex(actor, 's1')

    expect(assertWikiSpaceAccess).toHaveBeenCalledWith(actor, 's1', 'view')
    const sql = (vi.mocked(prisma.$queryRaw).mock.calls[0][0] as unknown as string[]).join('?')
    expect(sql).toContain('left("content"')
    expect(sql).toContain(`WHERE "spaceId" = ? AND "type" = 'design_doc'`)
    expect(sql).toContain('ORDER BY "order", "number"')
    expect(prisma.wikiPage.findMany).not.toHaveBeenCalled()
  })

  it('本文は返さず、front matter だけを添える(無ければ空文字)', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      row('p1', '---\nversion: 1.0\n---\n\n# 概要'),
      row('p2', '# 画面', 'p1'),
    ])

    expect(await getWikiDesignDocIndex(actor, 's1')).toEqual([
      { id: 'p1', parentId: null, number: 1, title: 'p1', frontMatter: '---\nversion: 1.0\n---\n' },
      { id: 'p2', parentId: 'p1', number: 2, title: 'p2', frontMatter: '' },
    ])
  })

  it('切り詰めた先頭では、途中で切れた最後の行を閉じの区切りとみなさない', async () => {
    // 先頭の末尾がちょうど「---」で切れるが、実際の行は「---x」で閉じの区切りではない
    const front = `---\nnote: ${filler(DESIGN_DOC_INDEX_HEAD - 14)}\n---`
    const content = `${front}x\nversion: 1.0\n---\n本文`
    vi.mocked(prisma.$queryRaw).mockResolvedValue([row('p1', content)])
    vi.mocked(prisma.wikiPage.findMany).mockResolvedValue([{ id: 'p1', content }] as never)

    const [doc] = await getWikiDesignDocIndex(actor, 's1')

    expect(row('p1', content).head.endsWith('\n---')).toBe(true)
    expect(doc.frontMatter).toContain('version: 1.0')
  })

  it('先頭に収まらない長い front matter の行だけ、本文全体を読み直す', async () => {
    const long = `---\nnote: ${filler(DESIGN_DOC_INDEX_HEAD)}\nversion: 2.0\n---\n本文`
    vi.mocked(prisma.$queryRaw).mockResolvedValue([row('p1', long), row('p2', '---\nversion: 1.0\n---\n')])
    vi.mocked(prisma.wikiPage.findMany).mockResolvedValue([{ id: 'p1', content: long }] as never)

    const docs = await getWikiDesignDocIndex(actor, 's1')

    expect(vi.mocked(prisma.wikiPage.findMany).mock.calls[0][0]).toEqual({
      where: { id: { in: ['p1'] } },
      select: { id: true, content: true },
    })
    expect(docs[0].frontMatter).toContain('version: 2.0')
    expect(docs[1].frontMatter).toBe('---\nversion: 1.0\n---\n')
  })

  it('front matter の無い長い本文や、先頭に収まる front matter の長い本文は読み直さない', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      row('p1', `# 概要\n${filler(DESIGN_DOC_INDEX_HEAD * 2)}`),
      row('p2', `---\nversion: 1.0\n---\n${filler(DESIGN_DOC_INDEX_HEAD * 2)}`),
    ])

    const docs = await getWikiDesignDocIndex(actor, 's1')

    expect(prisma.wikiPage.findMany).not.toHaveBeenCalled()
    expect(docs.map(({ frontMatter }) => frontMatter)).toEqual(['', '---\nversion: 1.0\n---\n'])
  })

  it('権限が無ければ引かない', async () => {
    vi.mocked(assertWikiSpaceAccess).mockRejectedValue(new Error('denied'))
    await expect(getWikiDesignDocIndex(actor, 's1')).rejects.toThrow('denied')
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })
})
