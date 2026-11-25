/**
 * Wiki スペースの割り当て(wiki-assignment.ts)
 */

import { INVALID_OPERATION } from '@/lib/error'
import { prisma } from '@/lib/prisma'
import { assertWikiSpaceAccess } from '@/lib/wiki/wiki-access'
import {
  getWikiSpaceAssignOptions,
  removeWikiSpaceBoard,
  removeWikiSpaceMember,
  upsertWikiSpaceBoard,
  upsertWikiSpaceGroup,
  upsertWikiSpaceMember,
} from '@/lib/wiki/wiki-assignment'
import { WIKI_SPACE_NO_OWNER } from '@/lib/wiki/wiki-rule'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    wikiSpaceMember: ['findMany', 'findUnique', 'upsert', 'delete'],
    wikiSpaceGroup: ['upsert'],
    wikiSpaceBoard: ['findUnique', 'upsert', 'deleteMany'],
    user: ['findUnique', 'findMany'],
    group: ['findUnique', 'findMany'],
    board: ['findFirst', 'findMany'],
  }),
)
vi.mock('@/lib/wiki/wiki-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wiki/wiki-access')>()),
  assertWikiSpaceAccess: vi.fn(),
}))

const owner = { id: 'u1', role: 'user' }
const admin = { id: 'a1', role: 'admin' }

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
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u2' } as never)
  vi.mocked(prisma.group.findUnique).mockResolvedValue({ id: 'g1' } as never)
  vi.mocked(prisma.wikiSpaceMember.findUnique).mockResolvedValue({ id: 'm1' } as never)
})

describe('upsertWikiSpaceMember', () => {
  it('manage を要求し、スペース行をロックしてから書く', async () => {
    vi.mocked(prisma.wikiSpaceMember.findMany).mockResolvedValue([{ userId: 'u1' }] as never)

    await upsertWikiSpaceMember(owner, { spaceId: 's1', userId: 'u2', role: 'editor' })

    expect(prisma.$queryRaw).toHaveBeenCalled()
    expect(assertWikiSpaceAccess).toHaveBeenCalledWith(owner, 's1', 'manage', expect.anything())
    expect(vi.mocked(prisma.wikiSpaceMember.upsert).mock.calls[0][0]).toMatchObject({
      create: { spaceId: 's1', userId: 'u2', role: 'editor' },
      update: { role: 'editor' },
    })
  })

  it('最後の owner を降格すると WIKI_SPACE_NO_OWNER', async () => {
    vi.mocked(prisma.wikiSpaceMember.findMany).mockResolvedValue([{ userId: 'u1' }] as never)

    expect(await errorTypeOf(upsertWikiSpaceMember(owner, { spaceId: 's1', userId: 'u1', role: 'editor' }))).toBe(
      WIKI_SPACE_NO_OWNER,
    )
    expect(prisma.wikiSpaceMember.upsert).not.toHaveBeenCalled()
  })

  it('ほかに owner がいれば降格できる', async () => {
    vi.mocked(prisma.wikiSpaceMember.findMany).mockResolvedValue([{ userId: 'u1' }, { userId: 'u3' }] as never)

    await upsertWikiSpaceMember(owner, { spaceId: 's1', userId: 'u1', role: 'viewer' })
    expect(prisma.wikiSpaceMember.upsert).toHaveBeenCalled()
  })

  it('管理者は owner を 0 人にできる', async () => {
    vi.mocked(prisma.wikiSpaceMember.findMany).mockResolvedValue([{ userId: 'u1' }] as never)

    await upsertWikiSpaceMember(admin, { spaceId: 's1', userId: 'u1', role: 'viewer' })
    expect(prisma.wikiSpaceMember.upsert).toHaveBeenCalled()
  })

  it('存在しないユーザーは割り当てない', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)

    expect(await errorTypeOf(upsertWikiSpaceMember(owner, { spaceId: 's1', userId: 'u9', role: 'viewer' }))).toBe(
      INVALID_OPERATION,
    )
  })

  it('権限が無ければ書かない', async () => {
    vi.mocked(assertWikiSpaceAccess).mockRejectedValueOnce(new Error('denied'))

    await expect(upsertWikiSpaceMember(owner, { spaceId: 's1', userId: 'u2', role: 'viewer' })).rejects.toThrow(
      'denied',
    )
    expect(prisma.wikiSpaceMember.upsert).not.toHaveBeenCalled()
  })
})

describe('removeWikiSpaceMember', () => {
  it('最後の owner は外せない', async () => {
    vi.mocked(prisma.wikiSpaceMember.findMany).mockResolvedValue([{ userId: 'u1' }] as never)

    expect(await errorTypeOf(removeWikiSpaceMember(owner, { spaceId: 's1', userId: 'u1' }))).toBe(WIKI_SPACE_NO_OWNER)
    expect(prisma.wikiSpaceMember.delete).not.toHaveBeenCalled()
  })

  it('owner 以外は外せる', async () => {
    vi.mocked(prisma.wikiSpaceMember.findMany).mockResolvedValue([{ userId: 'u1' }] as never)

    await removeWikiSpaceMember(owner, { spaceId: 's1', userId: 'u2' })
    expect(prisma.wikiSpaceMember.delete).toHaveBeenCalledWith({ where: { id: 'm1' } })
  })

  it('割り当てが無ければ INVALID_OPERATION', async () => {
    vi.mocked(prisma.wikiSpaceMember.findUnique).mockResolvedValue(null)

    expect(await errorTypeOf(removeWikiSpaceMember(owner, { spaceId: 's1', userId: 'u2' }))).toBe(INVALID_OPERATION)
  })
})

describe('upsertWikiSpaceGroup', () => {
  it('グループのロールを書く', async () => {
    await upsertWikiSpaceGroup(owner, { spaceId: 's1', groupId: 'g1', role: 'editor' })

    expect(assertWikiSpaceAccess).toHaveBeenCalledWith(owner, 's1', 'manage', expect.anything())
    expect(vi.mocked(prisma.wikiSpaceGroup.upsert).mock.calls[0][0]).toMatchObject({
      create: { spaceId: 's1', groupId: 'g1', role: 'editor' },
    })
  })
})

describe('upsertWikiSpaceBoard', () => {
  it('新しく割り当てるボードは、操作者が見えるチームボードに限る', async () => {
    vi.mocked(prisma.wikiSpaceBoard.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.board.findFirst).mockResolvedValue(null)

    expect(await errorTypeOf(upsertWikiSpaceBoard(owner, { spaceId: 's1', boardId: 'b1', role: 'viewer' }))).toBe(
      INVALID_OPERATION,
    )
    const where = vi.mocked(prisma.board.findFirst).mock.calls[0][0]?.where
    expect(where).toMatchObject({ id: 'b1', kind: 'team', archived: false })
    expect(where).toHaveProperty('AND')
    expect(prisma.wikiSpaceBoard.upsert).not.toHaveBeenCalled()
  })

  it('割り当て済みのボードは、見えなくなっていてもロールを変えられる', async () => {
    vi.mocked(prisma.wikiSpaceBoard.findUnique).mockResolvedValue({ id: 'wb1' } as never)
    vi.mocked(prisma.board.findFirst).mockResolvedValue(null)

    await upsertWikiSpaceBoard(owner, { spaceId: 's1', boardId: 'b1', role: 'editor' })
    expect(prisma.wikiSpaceBoard.upsert).toHaveBeenCalled()
  })

  it('管理者はボードの可視範囲で絞らない', async () => {
    vi.mocked(prisma.wikiSpaceBoard.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.board.findFirst).mockResolvedValue({ id: 'b1' } as never)

    await upsertWikiSpaceBoard(admin, { spaceId: 's1', boardId: 'b1', role: 'viewer' })
    expect(vi.mocked(prisma.board.findFirst).mock.calls[0][0]?.where).not.toHaveProperty('AND')
  })
})

describe('removeWikiSpaceBoard', () => {
  it('割り当てが無ければ INVALID_OPERATION', async () => {
    vi.mocked(prisma.wikiSpaceBoard.deleteMany).mockResolvedValue({ count: 0 })

    expect(await errorTypeOf(removeWikiSpaceBoard(owner, { spaceId: 's1', boardId: 'b1' }))).toBe(INVALID_OPERATION)
  })
})

describe('getWikiSpaceAssignOptions', () => {
  it('ボードの候補を「名前 (キー)」で返す', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([])
    vi.mocked(prisma.group.findMany).mockResolvedValue([])
    vi.mocked(prisma.board.findMany).mockResolvedValue([{ id: 'b1', name: '開発', key: 'DEV' }] as never)

    const options = await getWikiSpaceAssignOptions(owner, 's1')

    expect(assertWikiSpaceAccess).toHaveBeenCalledWith(owner, 's1', 'manage')
    expect(options.boardOptions).toEqual({ b1: '開発 (DEV)' })
  })
})
