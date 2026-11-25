/**
 * Wiki ページの復元(wiki-page.ts の restoreWikiPageRevision / restoreDeletedWikiPage)
 *
 * 版の内容への復元は削除されていないページの本文系だけを戻して位置を変えないこと、
 * 削除済みのページの復元は deletedAt を外し、親の有無で戻す先が変わり、配下ごと戻せることを、prisma を差し替えて確かめる。
 */

import { prisma } from '@/lib/prisma'
import { assertWikiSpaceAccess } from '@/lib/wiki/wiki-access'
import { restoreDeletedWikiPage, restoreWikiPageRevision } from '@/lib/wiki/wiki-page-restore'
import { writeWikiPageRevision } from '@/lib/wiki/wiki-revision'
import {
  MAX_WIKI_DEPTH,
  WIKI_PAGE_TOO_DEEP,
  WIKI_PAGE_TYPE_NOT_ALLOWED,
  WIKI_TREE_CHANGED,
  type WikiWriter,
} from '@/lib/wiki/wiki-rule'
import { findWikiTagsByIds, syncWikiPageTags } from '@/lib/wiki/wiki-tag'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    wikiPage: ['findUnique', 'findMany', 'update'],
    wikiPageRevision: ['findUnique'],
  }),
)
vi.mock('@/lib/wiki/wiki-access', () => ({ assertWikiSpaceAccess: vi.fn() }))
vi.mock('@/lib/wiki/wiki-revision', async (importOriginal) => ({
  WIKI_REVISION_ORDER: (await importOriginal<typeof import('@/lib/wiki/wiki-revision')>()).WIKI_REVISION_ORDER,
  writeWikiPageRevision: vi.fn(),
}))
vi.mock('@/lib/wiki/wiki-space', () => ({ getWikiSpaceByKey: vi.fn() }))
vi.mock('@/lib/board/board-access', () => ({ getTicketAccess: vi.fn() }))
vi.mock('@/lib/wiki/wiki-tag', () => ({
  assertWikiTagIdsInSpace: vi.fn(),
  findWikiTagsByIds: vi.fn(),
  syncWikiPageTags: vi.fn(),
}))

const actor = { id: 'u1' }
const WEB: WikiWriter = { via: 'web' }
const SPACE_ID = 's1'
const UPDATED_AT = new Date('2026-11-01T00:00:00.000Z')
const DELETED_AT = new Date('2026-11-05T00:00:00.000Z')

/** スペースに残っているタグ(tag-a は版の後で「旧設計」から改名、tag-gone は削除済み) */
const TAGS = [
  { id: 'tag-a', name: '設計' },
  { id: 'tag-b', name: '運用' },
]

type Row = { id: string; parentId: string | null; order: number }

/**
 * 生きているページ
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

const errorTypeOf = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (e) {
    return (e as { errorType?: string }).errorType
  }
  throw new Error('not rejected')
}

/** $executeRaw の SQL(テンプレートの文字列部分をつないだもの)と値 */
const executed = () =>
  vi.mocked(prisma.$executeRaw).mock.calls.map(([strings, ...values]) => ({
    sql: (strings as unknown as string[]).join('?').replace(/\s+/g, ' '),
    values,
  }))

/** 兄弟の並びの振り直し(VALUES)を [id, order] の列で取り出す */
const orderUpdates = () =>
  executed()
    .filter(({ sql }) => sql.includes('VALUES'))
    .flatMap(({ values }) =>
      values.flatMap((value) => {
        const flat = (value as { values?: unknown[] }).values ?? []
        return Array.from({ length: flat.length / 2 }, (_, i) => [flat[i * 2], flat[i * 2 + 1]])
      }),
    )

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertWikiSpaceAccess).mockResolvedValue({ spaceId: SPACE_ID, key: 'DOCS', type: 'mixed' } as never)
  vi.mocked(prisma.wikiPage.update).mockResolvedValue({ updatedAt: new Date() } as never)
  vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
  vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as never)
  vi.mocked(findWikiTagsByIds).mockImplementation(async (_tx, _spaceId, ids) =>
    TAGS.filter(({ id }) => ids.includes(id)),
  )
})

describe('restoreWikiPageRevision', () => {
  /** 戻し元の版 */
  const revision = (override: Record<string, unknown> = {}) => ({
    spaceId: SPACE_ID,
    pageId: 'x',
    title: '戻すタイトル',
    content: '戻す本文',
    type: 'design_doc',
    tags: [
      { id: 'tag-a', name: '旧設計' },
      { id: 'tag-gone', name: '廃止' },
    ],
    ...override,
  })

  /** 存在するページ x。位置は e の下 */
  const existingPage = (override: Record<string, unknown> = {}) => ({
    parentId: 'e',
    order: 0,
    number: 7,
    title: 'いまのタイトル',
    content: 'いまの本文',
    type: 'page',
    tags: [{ tag: { id: 'tag-b', name: '運用' } }],
    updatedAt: UPDATED_AT,
    ...override,
  })

  beforeEach(() => {
    vi.mocked(prisma.wikiPageRevision.findUnique).mockResolvedValue(revision() as never)
    vi.mocked(prisma.wikiPage.findUnique).mockResolvedValue(existingPage() as never)
  })

  it('タイトル・本文・種類・タグを版の内容に戻し、restored の版を残す。位置は変えない(改名したタグは今の名前で付く)', async () => {
    const result = await restoreWikiPageRevision(actor, WEB, 'rev-1')

    expect(result).toMatchObject({ result: 'updated', id: 'x', ref: 'DOCS/7', number: 7 })
    expect(assertWikiSpaceAccess).toHaveBeenCalledWith(actor, SPACE_ID, 'write', expect.anything())
    expect(vi.mocked(prisma.wikiPage.findUnique).mock.calls[0][0]?.where, '削除済みのページは対象にしない').toEqual({
      id: 'x',
      deletedAt: null,
    })
    const data = vi.mocked(prisma.wikiPage.update).mock.calls[0][0].data
    expect(data).toMatchObject({
      title: '戻すタイトル',
      content: '戻す本文',
      type: 'design_doc',
      updatedById: 'u1',
      updatedVia: 'web',
    })
    expect(data, '親・並びは変えない').not.toHaveProperty('parentId')
    expect(data).not.toHaveProperty('order')
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
    expect(syncWikiPageTags, '消えたタグは外す').toHaveBeenCalledWith(expect.anything(), 'x', ['tag-b'], ['tag-a'])
    expect(writeWikiPageRevision).toHaveBeenCalledWith(expect.anything(), {
      spaceId: SPACE_ID,
      pageId: 'x',
      action: 'restored',
      snapshot: {
        parentId: 'e',
        order: 0,
        title: '戻すタイトル',
        content: '戻す本文',
        type: 'design_doc',
        tags: [{ id: 'tag-a', name: '設計' }],
      },
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
        type: 'design_doc',
        tags: [{ tag: { id: 'tag-a', name: '設計' } }],
      }) as never,
    )

    const result = await restoreWikiPageRevision(actor, WEB, 'rev-1')

    expect(result).toMatchObject({ result: 'unchanged', updatedAt: UPDATED_AT })
    expect(prisma.wikiPage.update).not.toHaveBeenCalled()
    expect(writeWikiPageRevision).not.toHaveBeenCalled()
  })

  it('種類だけが違っても戻す。タグが同じなら付け直さない', async () => {
    vi.mocked(prisma.wikiPage.findUnique).mockResolvedValue(
      existingPage({
        title: '戻すタイトル',
        content: '戻す本文',
        tags: [{ tag: { id: 'tag-a', name: '設計' } }],
      }) as never,
    )

    const result = await restoreWikiPageRevision(actor, WEB, 'rev-1')

    expect(result.result).toBe('updated')
    expect(vi.mocked(prisma.wikiPage.update).mock.calls[0][0].data).toMatchObject({ type: 'design_doc' })
    expect(syncWikiPageTags).not.toHaveBeenCalled()
  })

  it('スペース行を共有ロック(本文の更新と同じ)してから権限を判定し、権限が無ければ何も書かない', async () => {
    vi.mocked(assertWikiSpaceAccess).mockRejectedValue(new Error('denied'))
    await expect(restoreWikiPageRevision(actor, WEB, 'rev-1')).rejects.toThrow('denied')
    const [strings] = vi.mocked(prisma.$queryRaw).mock.calls[0] as unknown as [TemplateStringsArray]
    expect(strings.join('?')).toContain('FOR SHARE')
    expect(vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(assertWikiSpaceAccess).mock.invocationCallOrder[0],
    )
    expect(prisma.wikiPage.update).not.toHaveBeenCalled()
    expect(writeWikiPageRevision).not.toHaveBeenCalled()
  })

  it('ページが削除済み(または無い)なら弾く', async () => {
    vi.mocked(prisma.wikiPage.findUnique).mockResolvedValue(null)
    await expect(restoreWikiPageRevision(actor, WEB, 'rev-1')).rejects.toMatchObject({
      errorType: 'INVALID_OPERATION',
    })
    expect(prisma.wikiPage.update).not.toHaveBeenCalled()
  })

  it('スペースの区分で作れない種類の版は戻せない', async () => {
    vi.mocked(assertWikiSpaceAccess).mockResolvedValue({ spaceId: SPACE_ID, key: 'DOCS', type: 'design_doc' } as never)
    vi.mocked(prisma.wikiPageRevision.findUnique).mockResolvedValue(revision({ type: 'page' }) as never)
    expect(await errorTypeOf(restoreWikiPageRevision(actor, WEB, 'rev-1'))).toBe(WIKI_PAGE_TYPE_NOT_ALLOWED)
    expect(prisma.wikiPage.update).not.toHaveBeenCalled()
  })

  it('版が無ければ(掃除で消えた)弾く', async () => {
    vi.mocked(prisma.wikiPageRevision.findUnique).mockResolvedValue(null)
    await expect(restoreWikiPageRevision(actor, WEB, 'rev-1')).rejects.toMatchObject({
      errorType: 'INVALID_OPERATION',
    })
  })
})

describe('restoreDeletedWikiPage', () => {
  /** 削除済みのページ(既定は x。元は親 a の 1 番目) */
  type Deleted = Row & { number: number; deletedAt: Date | null }
  let target: Deleted
  /** 削除済みのページ(配下を探すときに引く) */
  let deletedRows: Row[]
  /** 生きているページ */
  let tree: Row[]

  const snapshotRow = (id: string) => ({
    id,
    parentId: id === 'x' ? 'a' : 'x',
    order: 0,
    title: id,
    content: '',
    type: 'page',
    tags: [],
  })

  beforeEach(() => {
    target = { id: 'x', parentId: 'a', order: 1, number: 7, deletedAt: DELETED_AT }
    deletedRows = []
    tree = TREE
    vi.mocked(prisma.wikiPage.findUnique).mockImplementation((async () => ({ ...target, spaceId: SPACE_ID })) as never)
    vi.mocked(prisma.wikiPage.findMany).mockImplementation((async ({
      where,
    }: {
      where: { deletedAt?: unknown; id?: { in: string[] } }
    }) => {
      if (where.id) {
        return where.id.in.map(snapshotRow)
      }
      return where.deletedAt === null ? tree : deletedRows
    }) as never)
  })

  it('元の親が生きていれば、その下の元の位置へ戻し、deletedAt を外して restored の版を残す', async () => {
    const result = await restoreDeletedWikiPage(actor, WEB, 'x')

    expect(result).toEqual({ result: 'restored', id: 'x', ref: 'DOCS/7', number: 7, restored: 1 })
    expect(assertWikiSpaceAccess).toHaveBeenCalledWith(actor, SPACE_ID, 'write', expect.anything())
    // b と d の間に入り、d が後ろへずれる
    expect(orderUpdates()).toEqual([['d', 2]])
    const sqls = executed()
    expect(sqls.find(({ sql }) => sql.includes('"parentId" = ?'))?.values).toEqual(['a', 1, 'x'])
    const undelete = sqls.find(({ sql }) => sql.includes('"deletedAt" = NULL'))
    expect(undelete, '削除日時と削除者を外す').toBeDefined()
    expect(prisma.wikiPage.update, '更新日時を進めない(SQL で書く)').not.toHaveBeenCalled()
    expect(writeWikiPageRevision).toHaveBeenCalledTimes(1)
    expect(vi.mocked(writeWikiPageRevision).mock.calls[0][1]).toMatchObject({
      pageId: 'x',
      action: 'restored',
      actorId: 'u1',
      via: 'web',
    })
    expect(vi.mocked(writeWikiPageRevision).mock.calls[0][1]).not.toHaveProperty('restoredFromId')
  })

  it('元の親が生きていなければスペース直下の末尾へ戻す', async () => {
    target = { ...target, parentId: 'gone' }
    await restoreDeletedWikiPage(actor, WEB, 'x')
    expect(executed().find(({ sql }) => sql.includes('"parentId" = ?'))?.values).toEqual([null, 2, 'x'])
  })

  it('元の親の下では深さの上限を超えるなら、スペース直下へ戻す', async () => {
    // 上限の深さにある親 n{MAX}
    tree = Array.from({ length: MAX_WIKI_DEPTH }, (_, i) => ({
      id: `n${i + 1}`,
      parentId: i === 0 ? null : `n${i}`,
      order: 0,
    }))
    target = { ...target, parentId: `n${MAX_WIKI_DEPTH}`, order: 0 }
    await restoreDeletedWikiPage(actor, WEB, 'x')
    expect(executed().find(({ sql }) => sql.includes('"parentId" = ?'))?.values).toEqual([null, 1, 'x'])
  })

  it('配下ごとの復元では、削除済みの配下も同じトランザクションで戻し、配下の親子は保つ', async () => {
    deletedRows = [
      { id: 'x', parentId: 'a', order: 1 },
      { id: 'c1', parentId: 'x', order: 0 },
      { id: 'g1', parentId: 'c1', order: 0 },
      { id: 'other', parentId: null, order: 0 },
    ]

    const result = await restoreDeletedWikiPage(actor, WEB, 'x', { withDescendants: true })

    expect(result).toMatchObject({ result: 'restored', restored: 3 })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    const undelete = executed().find(({ sql }) => sql.includes('"deletedAt" = NULL'))
    expect((undelete?.values[0] as { values: unknown[] }).values).toEqual(['x', 'c1', 'g1'])
    // 移すのは x だけ(配下は x の下のまま)
    expect(executed().filter(({ sql }) => sql.includes('"parentId" = ?'))).toHaveLength(1)
    expect(vi.mocked(writeWikiPageRevision).mock.calls.map(([, revision]) => revision.pageId)).toEqual([
      'x',
      'c1',
      'g1',
    ])
  })

  it('配下ごと戻すと深さの上限を超えるなら、部分木ごとスペース直下へ戻す', async () => {
    tree = Array.from({ length: MAX_WIKI_DEPTH - 1 }, (_, i) => ({
      id: `n${i + 1}`,
      parentId: i === 0 ? null : `n${i}`,
      order: 0,
    }))
    target = { ...target, parentId: `n${MAX_WIKI_DEPTH - 1}`, order: 0 }
    deletedRows = [
      { id: 'x', parentId: target.parentId, order: 0 },
      { id: 'c1', parentId: 'x', order: 0 },
    ]

    await restoreDeletedWikiPage(actor, WEB, 'x', { withDescendants: true })

    expect(executed().find(({ sql }) => sql.includes('"parentId" = ?'))?.values[0]).toBeNull()
  })

  it('アナウンス用スペースは木を読まず、スペース直下へ戻す', async () => {
    vi.mocked(assertWikiSpaceAccess).mockResolvedValue({
      spaceId: SPACE_ID,
      key: 'NEWS',
      type: 'announcement',
    } as never)
    target = { ...target, parentId: null, order: 0 }

    await restoreDeletedWikiPage(actor, WEB, 'x')

    expect(
      vi.mocked(prisma.wikiPage.findMany).mock.calls.some(([args]) => args?.where?.deletedAt === null),
      '生きているページの木は読まない',
    ).toBe(false)
    expect(executed().find(({ sql }) => sql.includes('"parentId" = ?'))?.values).toEqual([null, 0, 'x'])
  })

  it('既に戻されていて、戻す配下も無ければ何もせず unchanged を返す', async () => {
    target = { ...target, deletedAt: null }

    const result = await restoreDeletedWikiPage(actor, WEB, 'x', { withDescendants: true })

    expect(result).toEqual({ result: 'unchanged', id: 'x', ref: 'DOCS/7', number: 7, restored: 0 })
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
    expect(writeWikiPageRevision).not.toHaveBeenCalled()
  })

  it('既に戻されていても、削除済みの配下は戻す(ページ自体は動かさない)', async () => {
    target = { ...target, deletedAt: null }
    deletedRows = [{ id: 'c1', parentId: 'x', order: 0 }]

    const result = await restoreDeletedWikiPage(actor, WEB, 'x', { withDescendants: true })

    expect(result).toMatchObject({ result: 'restored', restored: 1 })
    expect(executed().filter(({ sql }) => sql.includes('"parentId" = ?'))).toHaveLength(0)
    expect(vi.mocked(writeWikiPageRevision).mock.calls.map(([, revision]) => revision.pageId)).toEqual(['c1'])
  })

  it('確認で見せた配下と今の削除済みの配下が違えば、WIKI_TREE_CHANGED で何も戻さない', async () => {
    deletedRows = [
      { id: 'x', parentId: 'a', order: 1 },
      { id: 'c1', parentId: 'x', order: 0 },
      { id: 'c2', parentId: 'x', order: 1 },
    ]
    expect(
      await errorTypeOf(
        restoreDeletedWikiPage(actor, WEB, 'x', { withDescendants: true, expectedDescendantIds: ['c1'] }),
      ),
    ).toBe(WIKI_TREE_CHANGED)
    expect(prisma.$executeRaw).not.toHaveBeenCalled()

    const result = await restoreDeletedWikiPage(actor, WEB, 'x', {
      withDescendants: true,
      expectedDescendantIds: ['c2', 'c1'],
    })
    expect(result.restored).toBe(3)
  })

  it('既に戻されたページが深い位置へ移されていて、配下を戻すと深さの上限を超えるなら弾く', async () => {
    target = { ...target, parentId: `n${MAX_WIKI_DEPTH - 1}`, deletedAt: null }
    tree = [
      ...Array.from({ length: MAX_WIKI_DEPTH - 1 }, (_, i) => ({
        id: `n${i + 1}`,
        parentId: i === 0 ? null : `n${i}`,
        order: 0,
      })),
      { id: 'x', parentId: `n${MAX_WIKI_DEPTH - 1}`, order: 0 },
    ]
    deletedRows = [{ id: 'c1', parentId: 'x', order: 0 }]

    expect(await errorTypeOf(restoreDeletedWikiPage(actor, WEB, 'x', { withDescendants: true }))).toBe(
      WIKI_PAGE_TOO_DEEP,
    )
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })

  it('書き込み権限が無ければ何も書かない', async () => {
    vi.mocked(assertWikiSpaceAccess).mockRejectedValue(new Error('denied'))
    await expect(restoreDeletedWikiPage(actor, WEB, 'x')).rejects.toThrow('denied')
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })
})
