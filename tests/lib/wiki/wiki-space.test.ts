/**
 * Wiki スペースの作成・更新・一覧(wiki-space.ts)
 */

import { VALIDATION_ERROR } from '@/lib/error'
import { prisma } from '@/lib/prisma'
import { assertWikiSpaceAccess } from '@/lib/wiki/wiki-access'
import { DUPLICATED_WIKI_SPACE_KEY } from '@/lib/wiki/wiki-rule'
import { createWikiSpace, listWikiSpaces, setWikiSpaceArchived, updateWikiSpace } from '@/lib/wiki/wiki-space'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({ wikiSpace: ['create', 'update', 'findMany', 'findUnique'] }),
)
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
})

describe('createWikiSpace', () => {
  it('キーを大文字に寄せ、作成者を owner として割り当てる', async () => {
    await createWikiSpace(actor, { key: ' docs ', name: ' 開発ドキュメント ', description: '' })

    expect(vi.mocked(prisma.wikiSpace.create).mock.calls[0][0].data).toEqual({
      key: 'DOCS',
      name: '開発ドキュメント',
      description: null,
      visibility: 'restricted',
      members: { create: { userId: actor.id, role: 'owner' } },
    })
  })

  it('キーの重複は DUPLICATED_WIKI_SPACE_KEY', async () => {
    vi.mocked(prisma.wikiSpace.create).mockRejectedValue({ code: 'P2002' })
    expect(await errorTypeOf(createWikiSpace(actor, { key: 'DOCS', name: 'x' }))).toBe(DUPLICATED_WIKI_SPACE_KEY)
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

    expect(assertWikiSpaceAccess).toHaveBeenCalledWith(actor, 's1', 'manage')
    expect(vi.mocked(prisma.wikiSpace.update).mock.calls[0][0].data).toEqual({ visibility: 'everyone' })
  })

  it('アーカイブの切り替えも manage を要求する', async () => {
    await setWikiSpaceArchived(actor, 's1', true)
    expect(assertWikiSpaceAccess).toHaveBeenCalledWith(actor, 's1', 'manage')
    expect(vi.mocked(prisma.wikiSpace.update).mock.calls[0][0].data).toEqual({ archived: true })
  })

  it('権限が無ければ書かない', async () => {
    vi.mocked(assertWikiSpaceAccess).mockRejectedValue(new Error('denied'))
    await expect(updateWikiSpace(actor, 's1', { name: 'x' })).rejects.toThrow('denied')
    expect(prisma.wikiSpace.update).not.toHaveBeenCalled()
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
