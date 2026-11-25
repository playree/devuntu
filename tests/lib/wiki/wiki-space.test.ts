/**
 * Wiki スペースの作成・更新・一覧(wiki-space.ts)
 */

import { VALIDATION_ERROR } from '@/lib/error'
import { prisma } from '@/lib/prisma'
import { detachAttachmentsOf, listAttachmentKeysOf, removeAttachmentByKey } from '@/lib/storage/attachment'
import { assertWikiSpaceAccess } from '@/lib/wiki/wiki-access'
import { DUPLICATED_WIKI_SPACE_KEY } from '@/lib/wiki/wiki-rule'
import {
  createWikiSpace,
  deleteWikiSpace,
  findBoardWikiSpaceIndex,
  listWikiSpaces,
  setWikiSpaceArchived,
  updateWikiSpace,
} from '@/lib/wiki/wiki-space'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    wikiSpace: ['create', 'update', 'delete', 'findMany', 'findUnique'],
    wikiSpaceKeyHistory: ['create'],
  }),
)
vi.mock('@/lib/storage/attachment', () => ({
  listAttachmentKeysOf: vi.fn(),
  detachAttachmentsOf: vi.fn(),
  removeAttachmentByKey: vi.fn(),
}))
vi.mock('@/lib/wiki/wiki-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wiki/wiki-access')>()),
  assertWikiSpaceAccess: vi.fn(),
}))

const actor = { id: 'u1', role: 'user' }

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
  vi.mocked(prisma.wikiSpace.create).mockResolvedValue({ id: 's1' } as never)
  vi.mocked(assertWikiSpaceAccess).mockResolvedValue({ type: 'mixed' } as never)
  vi.mocked(listAttachmentKeysOf).mockResolvedValue([])
  vi.mocked(removeAttachmentByKey).mockResolvedValue(true)
})

describe('createWikiSpace', () => {
  it('キーを大文字に寄せ、作成者を owner として割り当てる', async () => {
    await createWikiSpace(actor, { key: ' docs ', name: ' 開発ドキュメント ', description: '' })

    expect(vi.mocked(prisma.wikiSpace.create).mock.calls[0][0].data).toEqual({
      key: 'DOCS',
      name: '開発ドキュメント',
      description: null,
      visibility: 'restricted',
      type: 'mixed',
      members: { create: { userId: actor.id, role: 'owner' } },
    })
  })

  it('区分を指定して作れる', async () => {
    await createWikiSpace(actor, { key: 'SPEC', name: '設計書', type: 'design_doc' })
    expect(vi.mocked(prisma.wikiSpace.create).mock.calls[0][0].data).toMatchObject({ type: 'design_doc' })
  })

  it('キーを履歴に登録してからスペースを作る', async () => {
    await createWikiSpace(actor, { key: 'docs', name: 'x' })

    expect(prisma.wikiSpaceKeyHistory.create).toHaveBeenCalledWith({ data: { key: 'DOCS' }, select: { key: true } })
    expect(vi.mocked(prisma.wikiSpaceKeyHistory.create).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.wikiSpace.create).mock.invocationCallOrder[0],
    )
  })

  it('キーの重複は DUPLICATED_WIKI_SPACE_KEY', async () => {
    vi.mocked(prisma.wikiSpace.create).mockRejectedValue({ code: 'P2002' })
    expect(await errorTypeOf(createWikiSpace(actor, { key: 'DOCS', name: 'x' }))).toBe(DUPLICATED_WIKI_SPACE_KEY)
  })

  it('削除したスペースのキー(履歴の重複)も DUPLICATED_WIKI_SPACE_KEY で、スペースを作らない', async () => {
    vi.mocked(prisma.wikiSpaceKeyHistory.create).mockRejectedValue({ code: 'P2002' })
    expect(await errorTypeOf(createWikiSpace(actor, { key: 'DOCS', name: 'x' }))).toBe(DUPLICATED_WIKI_SPACE_KEY)
    expect(prisma.wikiSpace.create).not.toHaveBeenCalled()
  })

  it.each(['D', '1DOC', 'DOCS-1', 'ABCDEFGHI'])('キーの形式外は検証エラー (%s)', async (key) => {
    expect(await errorTypeOf(createWikiSpace(actor, { key, name: 'x' }))).toBe(VALIDATION_ERROR)
    expect(prisma.wikiSpace.create).not.toHaveBeenCalled()
  })

  it('名前が空なら検証エラー', async () => {
    expect(await errorTypeOf(createWikiSpace(actor, { key: 'DOCS', name: ' ' }))).toBe(VALIDATION_ERROR)
  })
})

describe('updateWikiSpace / setWikiSpaceArchived', () => {
  it('設定の変更は manage を要求し、渡した項目だけを変える', async () => {
    await updateWikiSpace(actor, 's1', { visibility: 'everyone' })

    expect(assertWikiSpaceAccess).toHaveBeenCalledWith(actor, 's1', 'manage', expect.anything())
    expect(vi.mocked(prisma.wikiSpace.update).mock.calls[0][0].data).toEqual({ visibility: 'everyone' })
  })

  it('設定の変更は、スペース行のロックを取ってから権限を判定する', async () => {
    await updateWikiSpace(actor, 's1', { name: 'x' })
    expect(vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(assertWikiSpaceAccess).mock.invocationCallOrder[0],
    )
  })

  it('区分は変えられない(送られても書き込まない)', async () => {
    await updateWikiSpace(actor, 's1', { name: 'x', ...({ type: 'design_doc' } as object) })
    expect(vi.mocked(prisma.wikiSpace.update).mock.calls[0][0].data).toEqual({ name: 'x' })
  })

  it('アーカイブの切り替えも manage を要求する', async () => {
    await setWikiSpaceArchived(actor, 's1', true)
    expect(assertWikiSpaceAccess).toHaveBeenCalledWith(actor, 's1', 'manage', expect.anything())
    expect(vi.mocked(prisma.wikiSpace.update).mock.calls[0][0].data).toEqual({ archived: true })
  })

  it('アーカイブの切り替えも、スペース行のロックを取ってから権限を判定し、権限が無ければ書かない', async () => {
    vi.mocked(assertWikiSpaceAccess).mockRejectedValue(new Error('denied'))
    await expect(setWikiSpaceArchived(actor, 's1', true)).rejects.toThrow('denied')
    expect(vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(assertWikiSpaceAccess).mock.invocationCallOrder[0],
    )
    expect(prisma.wikiSpace.update).not.toHaveBeenCalled()
  })

  it('権限が無ければ書かない', async () => {
    vi.mocked(assertWikiSpaceAccess).mockRejectedValue(new Error('denied'))
    await expect(updateWikiSpace(actor, 's1', { name: 'x' })).rejects.toThrow('denied')
    expect(prisma.wikiSpace.update).not.toHaveBeenCalled()
  })
})

describe('deleteWikiSpace', () => {
  it('スペース行のロック → manage の判定 → 添付のキーを控えて紐付けを外す → スペースを消す、の順に行う', async () => {
    const order: string[] = []
    vi.mocked(prisma.$queryRaw).mockImplementation((async () => {
      order.push('lock')
      return []
    }) as never)
    vi.mocked(assertWikiSpaceAccess).mockImplementation((async () => {
      order.push('assert')
    }) as never)
    vi.mocked(listAttachmentKeysOf).mockImplementation(async () => {
      order.push('list')
      return []
    })
    vi.mocked(detachAttachmentsOf).mockImplementation(async () => {
      order.push('detach')
    })
    vi.mocked(prisma.wikiSpace.delete).mockImplementation((async () => {
      order.push('delete')
    }) as never)

    await deleteWikiSpace(actor, 's1')

    expect(order).toEqual(['lock', 'assert', 'list', 'detach', 'delete'])
    expect(assertWikiSpaceAccess).toHaveBeenCalledWith(actor, 's1', 'manage', expect.anything())
    expect(listAttachmentKeysOf).toHaveBeenCalledWith(expect.anything(), { kind: 'wikiSpace', wikiSpaceId: 's1' })
    expect(detachAttachmentsOf).toHaveBeenCalledWith(expect.anything(), { kind: 'wikiSpace', wikiSpaceId: 's1' })
    expect(prisma.wikiSpace.delete).toHaveBeenCalledWith({ where: { id: 's1' }, select: { id: true } })
  })

  it('コミット後に添付の実体を 1 つずつ消す', async () => {
    vi.mocked(listAttachmentKeysOf).mockResolvedValue(['k1', 'k2'])

    await deleteWikiSpace(actor, 's1')

    expect(vi.mocked(removeAttachmentByKey).mock.calls).toEqual([['k1'], ['k2']])
    expect(vi.mocked(prisma.wikiSpace.delete).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(removeAttachmentByKey).mock.invocationCallOrder[0],
    )
  })

  it('スペースの削除に失敗したら添付の実体は消さない', async () => {
    vi.mocked(listAttachmentKeysOf).mockResolvedValue(['k1'])
    vi.mocked(prisma.wikiSpace.delete).mockRejectedValue(new Error('db'))

    await expect(deleteWikiSpace(actor, 's1')).rejects.toThrow('db')
    expect(removeAttachmentByKey).not.toHaveBeenCalled()
  })

  it('管理権限が無ければ何も消さない', async () => {
    vi.mocked(assertWikiSpaceAccess).mockRejectedValue(new Error('denied'))

    await expect(deleteWikiSpace(actor, 's1')).rejects.toThrow('denied')
    expect(detachAttachmentsOf).not.toHaveBeenCalled()
    expect(prisma.wikiSpace.delete).not.toHaveBeenCalled()
    expect(removeAttachmentByKey).not.toHaveBeenCalled()
  })
})

describe('listWikiSpaces', () => {
  it('スペースごとに自分の実効ロールと権限を添える', async () => {
    const base = { key: 'K', name: 'n', description: null, archived: false, members: [], groups: [], boards: [] }
    vi.mocked(prisma.wikiSpace.findMany).mockResolvedValue([
      { ...base, id: 's1', visibility: 'everyone' },
      { ...base, id: 's2', visibility: 'restricted', boards: [{ role: 'editor' }] },
      { ...base, id: 's3', visibility: 'restricted', members: [{ role: 'owner' }], archived: true },
    ] as never)

    const spaces = await listWikiSpaces(actor, { includeArchived: true })

    expect(spaces.map(({ id, role, canWrite, canManage }) => ({ id, role, canWrite, canManage }))).toEqual([
      { id: 's1', role: 'viewer', canWrite: false, canManage: false },
      { id: 's2', role: 'editor', canWrite: true, canManage: false },
      { id: 's3', role: 'owner', canWrite: false, canManage: true },
    ])
    expect(spaces[0]).not.toHaveProperty('members')
  })
})

describe('findBoardWikiSpaceIndex', () => {
  const base = { description: null, archived: false, members: [], groups: [], boards: [] }

  it('ボードに割り当てられ、閲覧できるアーカイブ前のスペースに絞って引く', async () => {
    vi.mocked(prisma.wikiSpace.findMany).mockResolvedValue([])

    await findBoardWikiSpaceIndex(actor, 'b1')

    const where = vi.mocked(prisma.wikiSpace.findMany).mock.calls[0][0]?.where
    expect(where?.AND).toEqual(
      expect.arrayContaining([expect.objectContaining({ archived: false }), { boards: { some: { boardId: 'b1' } } }]),
    )
  })

  it('キー・名前・説明(あれば)・区分と書き込めるかを返し、0 件なら項目ごと返さない', async () => {
    vi.mocked(prisma.wikiSpace.findMany).mockResolvedValue([
      {
        ...base,
        key: 'DOCS',
        name: '開発',
        description: '設計と手順',
        visibility: 'restricted',
        type: 'design_doc',
        boards: [{ role: 'editor' }],
      },
      { ...base, key: 'PUB', name: '公開', visibility: 'everyone', type: 'mixed' },
    ] as never)

    expect(await findBoardWikiSpaceIndex(actor, 'b1')).toEqual({
      wikiSpaces: [
        { key: 'DOCS', name: '開発', description: '設計と手順', type: 'design_doc', canWrite: true },
        { key: 'PUB', name: '公開', type: 'mixed', canWrite: false },
      ],
    })

    vi.mocked(prisma.wikiSpace.findMany).mockResolvedValue([])
    expect(await findBoardWikiSpaceIndex(actor, 'b1')).toEqual({})
  })
})
