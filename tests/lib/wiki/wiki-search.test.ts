/**
 * Wiki の検索(wiki-search.ts)
 *
 * 組み立てる SQL(複数語の AND、語ごとのタイトル・本文・タグ名、タグの絞り込み、閲覧範囲、並び順)と、
 * 閲覧範囲の決め方・結果の組み立て・snippet の整形を確かめる。SQL の実行計画(GIN 索引)は開発 DB の EXPLAIN で確かめる
 */

import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { getAccessibleWikiSpaceIds } from '@/lib/wiki/wiki-access'
import { MAX_WIKI_SEARCH_LIMIT } from '@/lib/wiki/wiki-rule'
import { buildWikiSearchSql, formatWikiSnippet, searchWikiPages, type WikiSearchQuery } from '@/lib/wiki/wiki-search'
import { getWikiSpaceByKey } from '@/lib/wiki/wiki-space'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    wikiSpace: ['findMany'],
    wikiPageTag: ['findMany'],
  }),
)
vi.mock('@/lib/wiki/wiki-access', () => ({ getAccessibleWikiSpaceIds: vi.fn() }))
vi.mock('@/lib/wiki/wiki-space', () => ({ getWikiSpaceByKey: vi.fn() }))

const actor = { id: 'u1' }

const query = (override: Partial<WikiSearchQuery> = {}): WikiSearchQuery => ({
  words: [],
  tagNames: [],
  spaceIds: ['s1'],
  limit: 20,
  ...override,
})

/** 空白をつぶした SQL 文 */
const textOf = (sql: Prisma.Sql) => sql.text.replace(/\s+/g, ' ').trim()

/** 実行した検索の SQL */
const executedSql = () => vi.mocked(prisma.$queryRaw).mock.calls[0][0] as unknown as Prisma.Sql

describe('buildWikiSearchSql', () => {
  it('語ごとに「タイトルか本文の部分一致、またはタグ名の完全一致」を作り、AND でつなぐ', () => {
    const sql = buildWikiSearchSql(query({ words: ['設計書', 'api'] }))
    const text = textOf(sql)

    // 3文字以上の語は、索引で引けるようページ ID の集合(タイトル・本文の ILIKE と、タグ名の UNION)にする
    expect(
      text.match(
        /p\."id" IN \( SELECT "id" FROM "wiki_page" WHERE "title" ILIKE \$\d+ OR "content" ILIKE \$\d+ UNION/g,
      ),
    ).toHaveLength(2)
    expect(text.match(/lower\(t\."name"\) = lower\(\$\d+\)/g)).toHaveLength(2)
    expect(text).toMatch(/WHERE p\."spaceId" IN \(\$\d+\) AND p\."id" IN .* AND p\."id" IN/)
    expect(sql.values).toEqual(expect.arrayContaining(['%設計書%', '%api%', '設計書', 'api', 's1']))
  })

  it('2文字以下の語は、他の条件で絞った行への絞り込みとして書く(単独で全件を引かない)', () => {
    const text = textOf(buildWikiSearchSql(query({ words: ['設計書', 'DB'] })))

    expect(text.match(/SELECT "id" FROM "wiki_page" WHERE/g)).toHaveLength(1)
    expect(text).toMatch(
      /AND \(p\."title" ILIKE \$\d+ OR p\."content" ILIKE \$\d+ OR p\."id" IN \( SELECT pt\."pageId" .* lower\(t\."name"\) = lower\(\$\d+\)\)\)/,
    )
  })

  it('日本語も文字数で判定し、3文字以上の語は索引で引く', () => {
    const text = textOf(buildWikiSearchSql(query({ words: ['クラスタ', '構成'] })))
    expect(text.match(/SELECT "id" FROM "wiki_page" WHERE/g)).toHaveLength(1)
  })

  it('タイトルとの一致を先に、続けて更新日時の新しい順に並べ、件数を絞ってから snippet を切り出す', () => {
    const sql = buildWikiSearchSql(query({ words: ['設計', 'api'], limit: 7 }))
    const text = textOf(sql)

    expect(text).toMatch(/\(p\."title" ILIKE \$\d+ AND p\."title" ILIKE \$\d+\) AS "titleMatch"/)
    expect(text).toMatch(/ORDER BY "titleMatch" DESC, p\."updatedAt" DESC, p\."id" LIMIT \$\d+/)
    expect(text).toMatch(/ORDER BY pos\."titleMatch" DESC, pos\."updatedAt" DESC, pos\."id"$/)
    expect(text).toMatch(/LEAST\(NULLIF\(strpos\(lower\(p\."content"\), lower\(\$\d+\)\), 0\),NULLIF/)
    expect(sql.values).toContain(7)
  })

  it('タグの指定は、どれかを持つページに絞る(名前の一致)', () => {
    const text = textOf(buildWikiSearchSql(query({ tagNames: ['設計', '運用'] })))
    expect(text).toMatch(/WHERE t\."name" IN \(\$\d+,\$\d+\)/)
  })

  it('語が無ければタイトル一致を FALSE にし、snippet は本文の先頭から切り出す', () => {
    const text = textOf(buildWikiSearchSql(query({ tagNames: ['設計'] })))
    expect(text).toContain('(FALSE) AS "titleMatch"')
    expect(text).toContain('0 AS "hitAt"')
    expect(text).not.toContain('ILIKE')
  })

  it('閲覧範囲のスペースをすべて条件に入れる', () => {
    const sql = buildWikiSearchSql(query({ words: ['x'], spaceIds: ['s1', 's2', 's3'] }))
    expect(textOf(sql)).toMatch(/p\."spaceId" IN \(\$\d+,\$\d+,\$\d+\)/)
    expect(sql.values).toEqual(expect.arrayContaining(['s1', 's2', 's3']))
  })
})

describe('formatWikiSnippet', () => {
  it('改行と Markdown の記号をつぶし、前後が切れていれば … を付ける', () => {
    expect(
      formatWikiSnippet({
        snippet: '## 見出し\n\n- **API** の [仕様](https://example.com)\n`code`',
        snippetStart: 10,
        contentLength: 500,
      }),
    ).toBe('…見出し - API の 仕様 code…')
  })

  it('本文の先頭から末尾まで収まっていれば … を付けない', () => {
    expect(formatWikiSnippet({ snippet: '短い本文', snippetStart: 1, contentLength: 4 })).toBe('短い本文')
  })

  it('末尾の … の判定は、サロゲートペアを1文字として数える', () => {
    expect(formatWikiSnippet({ snippet: '😀😀', snippetStart: 1, contentLength: 3 })).toBe('😀😀…')
    expect(formatWikiSnippet({ snippet: '😀😀', snippetStart: 1, contentLength: 2 })).toBe('😀😀')
  })

  it('記号しか無ければ空文字', () => {
    expect(formatWikiSnippet({ snippet: '***', snippetStart: 1, contentLength: 3 })).toBe('')
  })
})

describe('searchWikiPages', () => {
  const ROW = {
    id: 'p3',
    spaceId: 's1',
    parentId: 'p2',
    number: 3,
    title: 'API 設計',
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    snippetStart: 1,
    snippet: 'API の設計',
    contentLength: 6,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // 使われずに残った mockResolvedValueOnce が次のテストへ持ち越されないようにする
    vi.mocked(prisma.$queryRaw).mockReset()
    vi.mocked(getAccessibleWikiSpaceIds).mockResolvedValue(['s1', 's2'])
    vi.mocked(getWikiSpaceByKey).mockResolvedValue({ space: { id: 's9' } } as never)
    // 1回目は検索、2回目はパンくず(先祖を近い順に depth 1, 2, …)
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([ROW] as never)
      .mockResolvedValueOnce([
        { pageId: 'p3', title: '設計書', depth: 1 },
        { pageId: 'p3', title: '開発', depth: 2 },
      ] as never)
    vi.mocked(prisma.wikiSpace.findMany).mockResolvedValue([{ id: 's1', key: 'DOCS', name: 'ドキュメント' }] as never)
    vi.mocked(prisma.wikiPageTag.findMany).mockResolvedValue([
      { pageId: 'p3', tag: { id: 't1', name: '設計', color: 'blue' } },
    ] as never)
  })

  it('スペースの指定が無ければ、閲覧できるスペース(アーカイブ済みを除く)だけを探す', async () => {
    await searchWikiPages(actor, { keyword: '設計' })

    expect(getAccessibleWikiSpaceIds).toHaveBeenCalledWith(actor.id)
    expect(getWikiSpaceByKey).not.toHaveBeenCalled()
    expect(executedSql().values).toEqual(expect.arrayContaining(['s1', 's2']))
  })

  it('スペースを指定すると、閲覧できるかを確かめてそのスペースだけを探す', async () => {
    await searchWikiPages(actor, { keyword: '設計', space: 'OPS' })

    expect(getWikiSpaceByKey).toHaveBeenCalledWith(actor, 'OPS')
    expect(getAccessibleWikiSpaceIds).not.toHaveBeenCalled()
    expect(executedSql().values).toContain('s9')
    expect(executedSql().values).not.toContain('s1')
  })

  it('閲覧できないスペースを指定すると、探さずにエラーを返す', async () => {
    vi.mocked(getWikiSpaceByKey).mockRejectedValue(new Error('denied'))
    await expect(searchWikiPages(actor, { keyword: '設計', space: 'SECRET' })).rejects.toThrow('denied')
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it('キーワードは NFKC で正規化し、空白で分けた語をすべて条件にする(最大5語)', async () => {
    await searchWikiPages(actor, { keyword: 'ＡＰＩ　設計 a b c d e' })

    const values = executedSql().values
    expect(values).toEqual(expect.arrayContaining(['%API%', '%設計%', '%a%', '%b%', '%c%']))
    expect(values).not.toContain('%d%')
  })

  it('語もタグも無ければ探さない', async () => {
    expect(await searchWikiPages(actor, { keyword: '  ', tags: [' '] })).toEqual([])
    expect(getAccessibleWikiSpaceIds).not.toHaveBeenCalled()
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it('閲覧できるスペースが無ければ探さない', async () => {
    vi.mocked(getAccessibleWikiSpaceIds).mockResolvedValue([])
    expect(await searchWikiPages(actor, { keyword: '設計' })).toEqual([])
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it('件数は上限に丸める', async () => {
    await searchWikiPages(actor, { keyword: '設計', limit: 1000 })
    expect(executedSql().values).toContain(MAX_WIKI_SEARCH_LIMIT)
  })

  it('パンくずは見つかったページの先祖だけを再帰でたどる', async () => {
    await searchWikiPages(actor, { keyword: '設計' })
    const sql = vi.mocked(prisma.$queryRaw).mock.calls[1]
    expect((sql[0] as unknown as TemplateStringsArray).join('')).toContain('WITH RECURSIVE')
    expect(sql.slice(1).flatMap((v) => (v as { values?: unknown[] }).values ?? [v])).toContain('p3')
  })

  it('ページの指定・パンくず・タグ・snippet を添えて返す', async () => {
    expect(await searchWikiPages(actor, { keyword: '設計' })).toEqual([
      {
        id: 'p3',
        ref: 'DOCS/3',
        space: { id: 's1', key: 'DOCS', name: 'ドキュメント' },
        number: 3,
        title: 'API 設計',
        updatedAt: ROW.updatedAt,
        tags: [{ id: 't1', name: '設計', color: 'blue' }],
        breadcrumbs: ['開発', '設計書'],
        snippet: 'API の設計',
      },
    ])
  })
})
