/**
 * Wiki スペースの認可判定(wiki-access.ts)
 *
 * 直接・グループ・ボード経由・everyone・アーカイブ・管理者の各経路で、view / write / manage を確かめる。
 * prisma は割り当てを絞り込んだ後の行(wikiRoleSelect の結果)を返す形で差し替える。
 */

import { boardVisibleWhere } from '@/lib/board/ticket-permission'
import { ClientError } from '@/lib/error'
import { prisma } from '@/lib/prisma'
import {
  assertWikiSpaceAccess,
  getAccessibleWikiSpaceIds,
  getWikiSpaceAccess,
  wikiSpaceVisibleWhere,
} from '@/lib/wiki/wiki-access'
import type { WikiRole } from '@/lib/wiki/wiki-rule'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({ wikiSpace: ['findUnique', 'findMany'] }),
)

const SPACE_ID = 's1'
const user = { id: 'u1', role: 'user' }
const admin = { id: 'u1', role: 'admin' }

type SpaceFixture = {
  visibility?: 'restricted' | 'everyone'
  archived?: boolean
  direct?: WikiRole | null
  groups?: WikiRole[]
  boards?: WikiRole[]
}

const mockSpace = (fixture: SpaceFixture | null) => {
  vi.mocked(prisma.wikiSpace.findUnique).mockResolvedValue(
    (fixture && {
      id: SPACE_ID,
      key: 'DOCS',
      visibility: fixture.visibility ?? 'restricted',
      archived: fixture.archived ?? false,
      members: fixture.direct ? [{ role: fixture.direct }] : [],
      groups: (fixture.groups ?? []).map((role) => ({ role })),
      boards: (fixture.boards ?? []).map((role) => ({ role })),
    }) as never,
  )
}

/** 許可されれば 'ok'、拒否されれば 'denied' */
const check = async (actor: { id: string; role?: string }, need: 'view' | 'write' | 'manage') => {
  try {
    await assertWikiSpaceAccess(actor, SPACE_ID, need)
    return 'ok'
  } catch (e) {
    expect(e).toBeInstanceOf(ClientError)
    return 'denied'
  }
}

const checkAll = async (actor: { id: string; role?: string }) => ({
  view: await check(actor, 'view'),
  write: await check(actor, 'write'),
  manage: await check(actor, 'manage'),
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('assertWikiSpaceAccess', () => {
  it.each([
    ['直接 owner', { direct: 'owner' }, { view: 'ok', write: 'ok', manage: 'ok' }],
    ['直接 editor', { direct: 'editor' }, { view: 'ok', write: 'ok', manage: 'denied' }],
    ['直接 viewer', { direct: 'viewer' }, { view: 'ok', write: 'denied', manage: 'denied' }],
    ['グループ経由 editor', { groups: ['editor'] }, { view: 'ok', write: 'ok', manage: 'denied' }],
    ['グループ経由 viewer', { groups: ['viewer'] }, { view: 'ok', write: 'denied', manage: 'denied' }],
    ['ボード経由 editor', { boards: ['editor'] }, { view: 'ok', write: 'ok', manage: 'denied' }],
    ['ボード経由 viewer', { boards: ['viewer'] }, { view: 'ok', write: 'denied', manage: 'denied' }],
    ['複数経路は最も強いもの', { direct: 'viewer', boards: ['editor'] }, { view: 'ok', write: 'ok', manage: 'denied' }],
    ['割り当て無し', {}, { view: 'denied', write: 'denied', manage: 'denied' }],
    ['everyone で割り当て無し', { visibility: 'everyone' }, { view: 'ok', write: 'denied', manage: 'denied' }],
    [
      'everyone で editor の割り当てあり',
      { visibility: 'everyone', groups: ['editor'] },
      { view: 'ok', write: 'ok', manage: 'denied' },
    ],
    ['アーカイブ済みの owner', { direct: 'owner', archived: true }, { view: 'ok', write: 'denied', manage: 'ok' }],
    [
      'アーカイブ済みの editor',
      { boards: ['editor'], archived: true },
      { view: 'ok', write: 'denied', manage: 'denied' },
    ],
  ] as const)('%s', async (_, fixture, expected) => {
    mockSpace(fixture as SpaceFixture)
    expect(await checkAll(user)).toEqual(expected)
  })

  it('管理者は割り当てが無くても管理だけできる(本文は読めない)', async () => {
    mockSpace({})
    expect(await checkAll(admin)).toEqual({ view: 'denied', write: 'denied', manage: 'ok' })
  })

  it('管理者でも割り当てがあれば、そのロールで読み書きできる', async () => {
    mockSpace({ direct: 'editor' })
    expect(await checkAll(admin)).toEqual({ view: 'ok', write: 'ok', manage: 'ok' })
  })

  it('スペースが無ければ管理者でも拒否する', async () => {
    mockSpace(null)
    expect(await checkAll(admin)).toEqual({ view: 'denied', write: 'denied', manage: 'denied' })
  })
})

describe('getWikiSpaceAccess', () => {
  it('ロールの解決に要る割り当てを、本人に関係する行へ絞って引く', async () => {
    mockSpace({ direct: 'editor' })
    const access = await getWikiSpaceAccess(user, SPACE_ID)

    expect(access).toMatchObject({ spaceId: SPACE_ID, key: 'DOCS', role: 'editor', canWrite: true })
    const { select } = vi.mocked(prisma.wikiSpace.findUnique).mock.calls[0][0] as { select: Record<string, unknown> }
    expect(select.members).toMatchObject({ where: { userId: user.id } })
    expect(select.groups).toMatchObject({ where: { group: { userGroups: { some: { userId: user.id } } } } })
    // ボード経由はボードの可視判定(直接・グループ経由のメンバー)をそのまま使う
    expect(select.boards).toMatchObject({ where: { board: boardVisibleWhere(user.id) } })
  })
})

describe('getAccessibleWikiSpaceIds', () => {
  it('既定はアーカイブ済みを除き、閲覧できる条件で絞る', async () => {
    vi.mocked(prisma.wikiSpace.findMany).mockResolvedValue([{ id: 's1' }, { id: 's2' }] as never)
    expect(await getAccessibleWikiSpaceIds(user.id)).toEqual(['s1', 's2'])
    expect(vi.mocked(prisma.wikiSpace.findMany).mock.calls[0][0]).toMatchObject({
      where: { archived: false, ...wikiSpaceVisibleWhere(user.id) },
    })
  })

  it('includeArchived ならアーカイブ済みも含める', async () => {
    vi.mocked(prisma.wikiSpace.findMany).mockResolvedValue([] as never)
    await getAccessibleWikiSpaceIds(user.id, { includeArchived: true })
    const { where } = vi.mocked(prisma.wikiSpace.findMany).mock.calls[0][0] as { where: Record<string, unknown> }
    expect(where).not.toHaveProperty('archived')
  })

  it('閲覧できる条件は everyone・直接・グループ・ボード経由のいずれか', () => {
    expect(wikiSpaceVisibleWhere('u1').OR).toEqual([
      { visibility: 'everyone' },
      { members: { some: { userId: 'u1' } } },
      { groups: { some: { group: { userGroups: { some: { userId: 'u1' } } } } } },
      { boards: { some: { board: boardVisibleWhere('u1') } } },
    ])
  })
})
