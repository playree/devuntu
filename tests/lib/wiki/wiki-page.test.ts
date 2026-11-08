/**
 * Wiki ページの書き込み(wiki-page.ts)
 *
 * 深さの上限・循環・配下ごとの削除・競合の検出と、兄弟の並び・版の記録を、prisma を差し替えて確かめる。
 */

import { getTicketAccess } from '@/lib/board/board-access'
import { VALIDATION_ERROR } from '@/lib/error'
import { prisma } from '@/lib/prisma'
import { assertWikiSpaceAccess } from '@/lib/wiki/wiki-access'
import { createWikiPage, deleteWikiPage, getWikiPage, moveWikiPage, updateWikiPage } from '@/lib/wiki/wiki-page'
import { writeWikiPageRevision } from '@/lib/wiki/wiki-revision'
import {
  MAX_WIKI_DEPTH,
  WIKI_PAGE_CONFLICT,
  WIKI_PAGE_HAS_CHILDREN,
  WIKI_PAGE_INVALID_PARENT,
  WIKI_PAGE_TOO_DEEP,
  type WikiWriter,
} from '@/lib/wiki/wiki-rule'
import { getWikiSpaceByKey } from '@/lib/wiki/wiki-space'
import { assertWikiTagIdsInSpace, syncWikiPageTags } from '@/lib/wiki/wiki-tag'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    wikiPage: ['findUnique', 'findUniqueOrThrow', 'findMany', 'create', 'update', 'delete'],
  }),
)
vi.mock('@/lib/wiki/wiki-access', () => ({ assertWikiSpaceAccess: vi.fn() }))
vi.mock('@/lib/wiki/wiki-revision', () => ({ writeWikiPageRevision: vi.fn() }))
vi.mock('@/lib/wiki/wiki-space', () => ({ getWikiSpaceByKey: vi.fn() }))
vi.mock('@/lib/board/board-access', () => ({ getTicketAccess: vi.fn() }))
vi.mock('@/lib/wiki/wiki-tag', () => ({ assertWikiTagIdsInSpace: vi.fn(), syncWikiPageTags: vi.fn() }))

/** スペースのタグ(表示順) */
const TAGS = [
  { id: 'tag-a', name: '設計' },
  { id: 'tag-b', name: '運用' },
  { id: 'tag-c', name: '下書き' },
]

const actor = { id: 'u1' }
const WEB: WikiWriter = { via: 'web' }
const MCP: WikiWriter = { via: 'mcp' }
const SPACE_ID = 's1'
const UPDATED_AT = new Date('2026-11-01T00:00:00.000Z')

type Row = { id: string; parentId: string | null; order: number }

/**
 * a ─ b ─ c
 *   └ d
 * e
 */
const TREE: Row[] = [
  { id: 'a', parentId: null, order: 0 },
  { id: 'e', parentId: null, order: 1 },
  { id: 'b', parentId: 'a', order: 0 },
  { id: 'd', parentId: 'a', order: 1 },
  { id: 'c', parentId: 'b', order: 0 },
]

/** 1 本につながった深さ `depth` の木(p1 ─ p2 ─ … ) */
const chain = (depth: number): Row[] =>
  Array.from({ length: depth }, (_, i) => ({ id: `p${i + 1}`, parentId: i === 0 ? null : `p${i}`, order: 0 }))

const pageRow = (id: string, override: Record<string, unknown> = {}) => {
  const row = TREE.find((r) => r.id === id)
  return {
    id,
    parentId: row?.parentId ?? null,
    order: row?.order ?? 0,
    title: `title-${id}`,
    content: `content-${id}`,
    tags: [],
    spaceId: SPACE_ID,
    number: 10,
    updatedAt: UPDATED_AT,
    ...override,
  }
}

let tree: Row[] = TREE

const errorTypeOf = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (e) {
    return (e as { errorType?: string }).errorType
  }
  throw new Error('not rejected')
}

/** 兄弟の並びの振り直し($executeRaw の VALUES)を [id, order] の列で取り出す */
const orderUpdates = () =>
  vi.mocked(prisma.$executeRaw).mock.calls.flatMap(([, ...values]) =>
    values.flatMap((value) => {
      const flat = (value as { values?: unknown[] }).values ?? []
      return Array.from({ length: flat.length / 2 }, (_, i) => [flat[i * 2], flat[i * 2 + 1]])
    }),
  )

/** 書き込みがロックを取ってから権限を判定したか */
const lockedBeforeAccessCheck = () =>
  vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0] < vi.mocked(assertWikiSpaceAccess).mock.invocationCallOrder[0]

beforeEach(() => {
  vi.clearAllMocks()
  tree = TREE
  vi.mocked(assertWikiSpaceAccess).mockResolvedValue({ key: 'DOCS' } as never)
  vi.mocked(prisma.wikiPage.findMany).mockImplementation((async (args: { where: { id?: { in: string[] } } }) =>
    args.where.id ? args.where.id.in.map((id) => pageRow(id)) : tree) as never)
  vi.mocked(prisma.wikiPage.findUnique).mockImplementation((async ({ where }: { where: { id: string } }) =>
    pageRow(where.id)) as never)
  vi.mocked(prisma.wikiPage.findUniqueOrThrow).mockImplementation((async ({ where }: { where: { id: string } }) =>
    pageRow(where.id)) as never)
  vi.mocked(prisma.wikiPage.update).mockResolvedValue({ updatedAt: new Date() } as never)
  vi.mocked(prisma.wikiPage.create).mockResolvedValue({ id: 'new', number: 11, updatedAt: new Date() } as never)
  // ロックの SELECT は結果を使わず、採番の UPDATE ... RETURNING だけが pageSeq を読む
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ pageSeq: 11 }] as never)
  vi.mocked(getTicketAccess).mockResolvedValue({ canView: true } as never)
  vi.mocked(assertWikiTagIdsInSpace).mockImplementation(async (_tx, _spaceId, ids) =>
    TAGS.filter(({ id }) => ids.includes(id)),
  )
})

describe('createWikiPage', () => {
  it('番号を採番して末尾に作り、created の版を残す', async () => {
    const result = await createWikiPage(actor, MCP, SPACE_ID, { title: ' 新規 ', parentId: 'a' }, { ticketId: 't1' })

    expect(result).toMatchObject({ result: 'created', id: 'new', ref: 'DOCS/11', number: 11 })
    expect(assertWikiSpaceAccess).toHaveBeenCalledWith(actor, SPACE_ID, 'write', expect.anything())
    expect(lockedBeforeAccessCheck()).toBe(true)
    expect(vi.mocked(prisma.wikiPage.create).mock.calls[0][0].data).toMatchObject({
      spaceId: SPACE_ID,
      parentId: 'a',
      number: 11,
      title: '新規',
      content: '',
      order: 2,
      createdById: actor.id,
      updatedVia: 'mcp',
    })
    expect(writeWikiPageRevision).toHaveBeenCalledWith(expect.anything(), {
      spaceId: SPACE_ID,
      pageId: 'new',
      pageNumber: 11,
      action: 'created',
      snapshot: { parentId: 'a', order: 2, title: '新規', content: '', tagNames: [] },
      actorId: actor.id,
      via: 'mcp',
      ticketId: 't1',
    })
  })

  it('位置を指定すると、後ろの兄弟の並びを詰め直す', async () => {
    await createWikiPage(actor, WEB, SPACE_ID, { title: '先頭', parentId: null, position: 0 })

    expect(vi.mocked(prisma.wikiPage.create).mock.calls[0][0].data).toMatchObject({ parentId: null, order: 0 })
    expect(orderUpdates()).toEqual([
      ['a', 1],
      ['e', 2],
    ])
  })

  it('存在しない親は WIKI_PAGE_INVALID_PARENT', async () => {
    expect(await errorTypeOf(createWikiPage(actor, WEB, SPACE_ID, { title: 'x', parentId: 'zz' }))).toBe(
      WIKI_PAGE_INVALID_PARENT,
    )
    expect(prisma.wikiPage.create).not.toHaveBeenCalled()
  })

  it('深さの上限の段にある親の下には作れない', async () => {
    tree = chain(MAX_WIKI_DEPTH)
    expect(
      await errorTypeOf(createWikiPage(actor, WEB, SPACE_ID, { title: 'x', parentId: `p${MAX_WIKI_DEPTH}` })),
    ).toBe(WIKI_PAGE_TOO_DEEP)
    // 1 段浅ければ作れる
    await createWikiPage(actor, WEB, SPACE_ID, { title: 'x', parentId: `p${MAX_WIKI_DEPTH - 1}` })
    expect(prisma.wikiPage.create).toHaveBeenCalledTimes(1)
  })

  it('タグを付けて作り、版の tagNames にタグの表示順で残す', async () => {
    await createWikiPage(actor, WEB, SPACE_ID, { title: '新規', tagIds: ['tag-b', 'tag-a'] })

    expect(assertWikiTagIdsInSpace).toHaveBeenCalledWith(expect.anything(), SPACE_ID, ['tag-b', 'tag-a'])
    expect(syncWikiPageTags).toHaveBeenCalledWith(expect.anything(), 'new', [], ['tag-a', 'tag-b'])
    expect(vi.mocked(writeWikiPageRevision).mock.calls[0][1].snapshot.tagNames).toEqual(['設計', '運用'])
  })

  it('タイトルが空なら検証エラー', async () => {
    expect(await errorTypeOf(createWikiPage(actor, WEB, SPACE_ID, { title: '  ' }))).toBe(VALIDATION_ERROR)
  })

  it('閲覧できないチケットは紐づけない', async () => {
    vi.mocked(getTicketAccess).mockResolvedValue(null)
    expect(await errorTypeOf(createWikiPage(actor, WEB, SPACE_ID, { title: 'x' }, { ticketId: 't9' }))).toBe(
      VALIDATION_ERROR,
    )
  })
})

describe('updateWikiPage', () => {
  it('expectedUpdatedAt が日時として読めなければ、競合ではなく検証エラー', async () => {
    expect(
      await errorTypeOf(updateWikiPage(actor, WEB, 'b', { content: 'x' }, { expectedUpdatedAt: 'yesterday' })),
    ).toBe(VALIDATION_ERROR)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('スペース行をロックしてから権限(アーカイブ)を判定する', async () => {
    await updateWikiPage(actor, WEB, 'b', { content: 'x' })
    expect(lockedBeforeAccessCheck()).toBe(true)
  })

  it('変更を保存して updated の版を残す', async () => {
    const result = await updateWikiPage(actor, WEB, 'b', { content: '新しい本文' })

    expect(result).toMatchObject({ result: 'updated', ref: 'DOCS/10' })
    expect(vi.mocked(prisma.wikiPage.update).mock.calls[0][0].data).toMatchObject({
      title: 'title-b',
      content: '新しい本文',
      updatedById: actor.id,
      updatedVia: 'web',
    })
    expect(vi.mocked(writeWikiPageRevision).mock.calls[0][1]).toMatchObject({
      pageId: 'b',
      action: 'updated',
      snapshot: { parentId: 'a', order: 0, title: 'title-b', content: '新しい本文', tagNames: [] },
    })
  })

  it('内容が変わらなければ書かない', async () => {
    const result = await updateWikiPage(actor, WEB, 'b', { title: 'title-b', content: 'content-b' })
    expect(result.result).toBe('unchanged')
    expect(prisma.wikiPage.update).not.toHaveBeenCalled()
    expect(writeWikiPageRevision).not.toHaveBeenCalled()
  })

  describe('タグ', () => {
    const withTags = (ids: string[]) =>
      vi
        .mocked(prisma.wikiPage.findUnique)
        .mockResolvedValue(
          pageRow('b', { tags: TAGS.filter(({ id }) => ids.includes(id)).map((tag) => ({ tag })) }) as never,
        )

    it('タグだけを変えても保存し、差分を同期して版の tagNames を新しいタグにする', async () => {
      withTags(['tag-a', 'tag-b'])
      const result = await updateWikiPage(actor, WEB, 'b', { tagIds: ['tag-c', 'tag-a'] })

      expect(result.result).toBe('updated')
      expect(assertWikiTagIdsInSpace).toHaveBeenCalledWith(expect.anything(), SPACE_ID, ['tag-c', 'tag-a'])
      expect(syncWikiPageTags).toHaveBeenCalledWith(expect.anything(), 'b', ['tag-a', 'tag-b'], ['tag-a', 'tag-c'])
      expect(vi.mocked(writeWikiPageRevision).mock.calls[0][1].snapshot.tagNames).toEqual(['設計', '下書き'])
    })

    it('並びが違うだけなら変化なし', async () => {
      withTags(['tag-a', 'tag-b'])
      const result = await updateWikiPage(actor, WEB, 'b', { tagIds: ['tag-b', 'tag-a'] })

      expect(result.result).toBe('unchanged')
      expect(syncWikiPageTags).not.toHaveBeenCalled()
      expect(writeWikiPageRevision).not.toHaveBeenCalled()
    })

    it('tagIds を渡さなければタグに触れず、版には今のタグを残す', async () => {
      withTags(['tag-a'])
      await updateWikiPage(actor, WEB, 'b', { content: '新しい本文' })

      expect(assertWikiTagIdsInSpace).not.toHaveBeenCalled()
      expect(syncWikiPageTags).not.toHaveBeenCalled()
      expect(vi.mocked(writeWikiPageRevision).mock.calls[0][1].snapshot.tagNames).toEqual(['設計'])
    })

    it('別のスペースのタグは付けられない', async () => {
      vi.mocked(assertWikiTagIdsInSpace).mockRejectedValueOnce(new Error('invalid'))
      await expect(updateWikiPage(actor, WEB, 'b', { tagIds: ['other'] })).rejects.toThrow('invalid')
      expect(prisma.wikiPage.update).not.toHaveBeenCalled()
    })
  })

  it('読んだ後に更新されていれば WIKI_PAGE_CONFLICT', async () => {
    expect(
      await errorTypeOf(
        updateWikiPage(actor, WEB, 'b', { content: 'x' }, { expectedUpdatedAt: '2026-10-01T00:00:00.000Z' }),
      ),
    ).toBe(WIKI_PAGE_CONFLICT)
    await updateWikiPage(actor, WEB, 'b', { content: 'x' }, { expectedUpdatedAt: UPDATED_AT.toISOString() })
    expect(prisma.wikiPage.update).toHaveBeenCalledTimes(1)
  })
})

describe('moveWikiPage', () => {
  it('別の親の末尾へ移し、moved の版を残す', async () => {
    const result = await moveWikiPage(actor, WEB, 'b', { parentId: 'e' })

    expect(result.result).toBe('moved')
    expect(vi.mocked(prisma.wikiPage.update).mock.calls.at(-1)?.[0].data).toMatchObject({ parentId: 'e', order: 0 })
    expect(vi.mocked(writeWikiPageRevision).mock.calls[0][1]).toMatchObject({
      pageId: 'b',
      action: 'moved',
      snapshot: { parentId: 'e', order: 0, title: 'title-b' },
    })
  })

  it('同じ親の中で並べ替える', async () => {
    await moveWikiPage(actor, WEB, 'd', { parentId: 'a', position: 0 })

    expect(orderUpdates()).toEqual([['b', 1]])
    expect(vi.mocked(prisma.wikiPage.update).mock.calls.at(-1)?.[0].data).toMatchObject({ parentId: 'a', order: 0 })
  })

  it('親も位置も変わらなければ書かない', async () => {
    const result = await moveWikiPage(actor, WEB, 'b', { parentId: 'a', position: 0 })
    expect(result.result).toBe('unchanged')
    expect(writeWikiPageRevision).not.toHaveBeenCalled()
  })

  it('order に隙間があっても、並びが変わらなければ書かない', async () => {
    // 削除で 1 が抜けた兄弟 x(0) y(2)。y を今と同じ 2 番目へ移しても何も起きない
    tree = [
      { id: 'x', parentId: null, order: 0 },
      { id: 'y', parentId: null, order: 2 },
    ]
    vi.mocked(prisma.wikiPage.findUniqueOrThrow).mockResolvedValue(pageRow('y', { parentId: null, order: 2 }) as never)
    expect((await moveWikiPage(actor, WEB, 'y', { parentId: null, position: 1 })).result).toBe('unchanged')
    expect(prisma.wikiPage.update).not.toHaveBeenCalled()
  })

  it('order が同値の兄弟どうしでも、並びが変われば移す', async () => {
    tree = [
      { id: 'x', parentId: null, order: 0 },
      { id: 'y', parentId: null, order: 2 },
      { id: 'z', parentId: null, order: 2 },
    ]
    vi.mocked(prisma.wikiPage.findUniqueOrThrow).mockResolvedValue(pageRow('y', { parentId: null, order: 2 }) as never)
    expect((await moveWikiPage(actor, WEB, 'y', { parentId: null, position: 2 })).result).toBe('moved')
    expect(orderUpdates()).toEqual([['z', 1]])
  })

  it('押し出された兄弟は 1 文で並びだけを変え、更新日時を動かさない', async () => {
    await moveWikiPage(actor, WEB, 'e', { parentId: null, position: 0 })

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    expect(orderUpdates()).toEqual([['a', 1]])
    // wikiPage.update(@updatedAt が進む)は移したページ自身だけ
    expect(vi.mocked(prisma.wikiPage.update).mock.calls.map(([args]) => args.where.id)).toEqual(['e'])
  })

  it.each([
    ['自分自身', 'b'],
    ['子孫', 'c'],
    ['存在しないページ', 'zz'],
  ])('%s の下へは移せない(循環)', async (_, parentId) => {
    expect(await errorTypeOf(moveWikiPage(actor, WEB, 'b', { parentId }))).toBe(WIKI_PAGE_INVALID_PARENT)
    expect(prisma.wikiPage.update).not.toHaveBeenCalled()
  })

  it('部分木ごと移した後に深さの上限を超えるなら弾く', async () => {
    // p1 ─ … ─ p(MAX-1) の先に、高さ 2 の部分木 q1 ─ q2 を付けると MAX + 1 段になる
    tree = [
      ...chain(MAX_WIKI_DEPTH - 1),
      { id: 'q1', parentId: null, order: 1 },
      { id: 'q2', parentId: 'q1', order: 0 },
    ]
    expect(await errorTypeOf(moveWikiPage(actor, WEB, 'q1', { parentId: `p${MAX_WIKI_DEPTH - 1}` }))).toBe(
      WIKI_PAGE_TOO_DEEP,
    )
    await moveWikiPage(actor, WEB, 'q1', { parentId: `p${MAX_WIKI_DEPTH - 2}` })
    expect(writeWikiPageRevision).toHaveBeenCalledTimes(1)
  })

  it('読んだ後に更新されていれば WIKI_PAGE_CONFLICT', async () => {
    expect(
      await errorTypeOf(
        moveWikiPage(actor, WEB, 'b', { parentId: 'e' }, { expectedUpdatedAt: '2026-10-01T00:00:00.000Z' }),
      ),
    ).toBe(WIKI_PAGE_CONFLICT)
  })
})

describe('deleteWikiPage', () => {
  it('子孫がいるのに recursive が無ければ WIKI_PAGE_HAS_CHILDREN(件数をメッセージに含める)', async () => {
    await expect(deleteWikiPage(actor, MCP, 'a')).rejects.toMatchObject({
      errorType: WIKI_PAGE_HAS_CHILDREN,
      message: expect.stringContaining('3 descendant'),
    })
    expect(prisma.wikiPage.delete).not.toHaveBeenCalled()
    expect(writeWikiPageRevision).not.toHaveBeenCalled()
  })

  it('recursive なら配下ごと消し、消すページごとに deleted の版を残す', async () => {
    const result = await deleteWikiPage(actor, MCP, 'a', { recursive: true, ticketId: 't1' })

    expect(result).toEqual({ deleted: 4 })
    const revisions = vi.mocked(writeWikiPageRevision).mock.calls.map(([, revision]) => revision)
    expect(revisions.map(({ pageId }) => pageId).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(
      revisions.every(({ action, via, ticketId }) => action === 'deleted' && via === 'mcp' && ticketId === 't1'),
    ).toBe(true)
    // 子孫は parentId の Cascade で消えるので、消すのは指定したページだけ
    expect(prisma.wikiPage.delete).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.wikiPage.delete).mock.calls[0][0]).toMatchObject({ where: { id: 'a' } })
  })

  it('消すページの行をロックしてから内容を読む(並行する更新の後の内容を版に残す)', async () => {
    await deleteWikiPage(actor, WEB, 'b', { recursive: true })

    const lockCall = vi
      .mocked(prisma.$queryRaw)
      .mock.calls.find(([strings]) => (strings as TemplateStringsArray).join('').includes('"wiki_page"'))
    const locked = (lockCall?.[1] as { values: string[] }).values
    expect([...locked].sort()).toEqual(['b', 'c'])
    const lockOrder = vi.mocked(prisma.$queryRaw).mock.invocationCallOrder.at(-1)!
    const readOrder = vi.mocked(prisma.wikiPage.findMany).mock.invocationCallOrder.at(-1)!
    expect(lockOrder).toBeLessThan(readOrder)
  })

  it('子孫がいなければ recursive 無しで消せる', async () => {
    expect(await deleteWikiPage(actor, WEB, 'c')).toEqual({ deleted: 1 })
  })
})

describe('getWikiPage', () => {
  it('パンくず(先祖を上から)と子ページを添える', async () => {
    vi.mocked(getWikiSpaceByKey).mockResolvedValue({ space: { id: SPACE_ID }, access: {} } as never)
    vi.mocked(prisma.wikiPage.findUnique).mockResolvedValue({ id: 'b' } as never)
    const titled = TREE.map((row, i) => ({ ...row, number: i + 1, title: `T-${row.id}` }))
    vi.mocked(prisma.wikiPage.findMany).mockResolvedValue(titled as never)

    const detail = await getWikiPage(actor, 'DOCS', 3)

    expect(detail.ancestors).toEqual([{ number: 1, title: 'T-a' }])
    expect(detail.children).toEqual([{ number: 5, title: 'T-c' }])
  })
})
