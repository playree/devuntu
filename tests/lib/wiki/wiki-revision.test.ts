/**
 * Wiki ページの版の書き込み(wiki-revision.ts)
 *
 * 連続保存のまとめと、1ページあたりの上限を超えた分の削除、版の一覧・本文・内容・削除済みページの参照、版の削除を確かめる。
 */

import { prisma } from '@/lib/prisma'
import { assertWikiSpaceAccess } from '@/lib/wiki/wiki-access'
import {
  deleteWikiPageRevision,
  getWikiPageRevisionContent,
  getWikiPageRevisionSnapshot,
  listDeletedWikiPages,
  listWikiPageRevisions,
  writeWikiPageRevision,
  type WriteWikiPageRevision,
} from '@/lib/wiki/wiki-revision'
import type { WikiPageSnapshot } from '@/lib/wiki/wiki-rule'
import { listWikiTags } from '@/lib/wiki/wiki-tag'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings = { merge: 10, max: 3, retention: 7 }

vi.mock('@/lib/env-util', () => ({
  envu: {
    server: {
      get WIKI_REVISION_MERGE_MINUTES() {
        return settings.merge
      },
      get WIKI_REVISION_MAX_PER_PAGE() {
        return settings.max
      },
      get WIKI_REVISION_RETENTION_DAYS() {
        return settings.retention
      },
    },
  },
}))

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    wikiPageRevision: ['findFirst', 'findUnique', 'findMany', 'create', 'update', 'deleteMany'],
    wikiPage: ['findUnique', 'findMany'],
    ticket: ['findMany'],
  }),
)
vi.mock('@/lib/wiki/wiki-access', () => ({ assertWikiSpaceAccess: vi.fn() }))
vi.mock('@/lib/wiki/wiki-tag', () => ({ listWikiTags: vi.fn() }))

const NOW = new Date('2026-11-08T10:00:00.000Z')
const snapshot: WikiPageSnapshot = {
  parentId: null,
  order: 0,
  title: 'タイトル',
  content: '本文',
  type: 'page',
  tags: [{ id: 't1', name: '設計' }],
}

/** snapshot を版の行に書いたときの列(タグは ID と名前の JSON) */
const snapshotColumns = {
  parentId: null,
  order: 0,
  title: 'タイトル',
  content: '本文',
  type: 'page',
  tags: [{ id: 't1', name: '設計' }],
}

const revision = (override: Partial<WriteWikiPageRevision> = {}): WriteWikiPageRevision => ({
  spaceId: 's1',
  pageId: 'p1',
  action: 'updated',
  snapshot,
  actorId: 'u1',
  via: 'web',
  ...override,
})

/** 最新の版。既定は今回と同じ人・経路で 5 分前の updated(まとめる対象) */
const latest = (override: Record<string, unknown> = {}) => ({
  id: 'r-latest',
  number: 4,
  action: 'updated',
  actorId: 'u1',
  via: 'web',
  ticketId: null,
  message: null,
  createdAt: new Date('2026-11-08T09:55:00.000Z'),
  updatedAt: new Date('2026-11-08T09:58:00.000Z'),
  ...override,
})

/** チケットの閲覧可否の問い合わせに、`viewable` を満たす ID だけを返す */
const mockViewableTickets = (viewable: (id: string) => boolean) =>
  vi
    .mocked(prisma.ticket.findMany)
    .mockImplementation(((args: { where: { id: { in: string[] } } }) =>
      Promise.resolve(args.where.id.in.filter(viewable).map((id) => ({ id })))) as never)

beforeEach(() => {
  vi.clearAllMocks()
  settings.merge = 10
  settings.max = 3
  settings.retention = 7
  vi.mocked(assertWikiSpaceAccess).mockResolvedValue({ key: 'DOCS' } as never)
  mockViewableTickets(() => true)
  vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.wikiPageRevision.findMany).mockResolvedValue([])
})

describe('writeWikiPageRevision: 連続保存のまとめ', () => {
  it('条件を満たせば最新の版を上書きし、updatedAt を進める', async () => {
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue(latest() as never)

    expect(await writeWikiPageRevision(prisma, revision(), NOW)).toBe('merged')
    expect(prisma.wikiPageRevision.update).toHaveBeenCalledWith({
      where: { id: 'r-latest' },
      data: { ...snapshotColumns, updatedAt: NOW },
    })
    expect(prisma.wikiPageRevision.create).not.toHaveBeenCalled()
  })

  it.each([
    ['時間を過ぎている', latest({ createdAt: new Date('2026-11-08T09:49:00.000Z') }), revision()],
    ['別の人', latest({ actorId: 'u2' }), revision()],
    ['別の経路', latest({ via: 'mcp' }), revision()],
    ['別のチケット', latest({ ticketId: 't1' }), revision()],
    ['最新の版が created', latest({ action: 'created' }), revision()],
    ['最新の版にコミットメッセージがある', latest({ message: '見出しを整理' }), revision()],
  ])('%s なら新しい版を作る', async (_, last, next) => {
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue(last as never)

    expect(await writeWikiPageRevision(prisma, next, NOW)).toBe('created')
    expect(prisma.wikiPageRevision.update).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.wikiPageRevision.create).mock.calls[0][0].data).toMatchObject({
      pageId: 'p1',
      number: 5,
      action: 'updated',
      actorId: 'u1',
      ticketId: null,
      ...snapshotColumns,
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('コミットメッセージ付きの保存はまとめず、新しい版にメッセージを残す', async () => {
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue(latest() as never)

    expect(await writeWikiPageRevision(prisma, revision({ message: '見出しを整理' }), NOW)).toBe('created')
    expect(prisma.wikiPageRevision.update).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.wikiPageRevision.create).mock.calls[0][0].data).toMatchObject({
      number: 5,
      message: '見出しを整理',
    })
  })

  it('updated 以外はまとめずに新しい版を作る', async () => {
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue(latest() as never)
    expect(await writeWikiPageRevision(prisma, revision({ action: 'moved' }), NOW)).toBe('created')
    expect(prisma.wikiPageRevision.update).not.toHaveBeenCalled()
  })

  it('まとめる時間が 0 ならまとめない', async () => {
    settings.merge = 0
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue(latest() as never)
    expect(await writeWikiPageRevision(prisma, revision(), NOW)).toBe('created')
    expect(prisma.wikiPageRevision.update).not.toHaveBeenCalled()
  })

  describe('まとめる時間が保持期間より長い(保持 1 日・まとめ 2000 分)', () => {
    beforeEach(() => {
      settings.retention = 1
      settings.merge = 2000
    })

    it('最新の版の最後の保存が保持期限より前なら(掃除が基準版として残す版なので)まとめない', async () => {
      const twoDaysAgo = new Date('2026-11-06T10:00:00.000Z')
      vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue(
        latest({ createdAt: twoDaysAgo, updatedAt: twoDaysAgo }) as never,
      )
      expect(await writeWikiPageRevision(prisma, revision(), NOW)).toBe('created')
      expect(prisma.wikiPageRevision.update).not.toHaveBeenCalled()
    })

    it('最新の版の最後の保存が保持期限の内なら、作成が期限より前でもまとめる', async () => {
      vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue(
        latest({
          createdAt: new Date('2026-11-07T02:00:00.000Z'),
          updatedAt: new Date('2026-11-07T12:00:00.000Z'),
        }) as never,
      )
      expect(await writeWikiPageRevision(prisma, revision(), NOW)).toBe('merged')
    })
  })
})

describe('writeWikiPageRevision: 版の番号', () => {
  it('版が無ければ 1 から振る', async () => {
    await writeWikiPageRevision(prisma, revision({ action: 'created' }), NOW)
    expect(vi.mocked(prisma.wikiPageRevision.create).mock.calls[0][0].data).toMatchObject({ number: 1 })
  })

  it('updated 以外でも最新の版の番号に続ける', async () => {
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue(latest({ number: 7 }) as never)
    await writeWikiPageRevision(prisma, revision({ action: 'moved' }), NOW)
    expect(vi.mocked(prisma.wikiPageRevision.findFirst).mock.calls[0][0]).toMatchObject({
      where: { pageId: 'p1' },
      orderBy: { number: 'desc' },
    })
    expect(vi.mocked(prisma.wikiPageRevision.create).mock.calls[0][0].data).toMatchObject({ number: 8 })
  })

  it('まとめたときは番号を変えない', async () => {
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue(latest() as never)
    await writeWikiPageRevision(prisma, revision(), NOW)
    expect(vi.mocked(prisma.wikiPageRevision.update).mock.calls[0][0].data).not.toHaveProperty('number')
  })
})

describe('writeWikiPageRevision: 件数の上限', () => {
  it('上限を超えた古い版を消す', async () => {
    vi.mocked(prisma.wikiPageRevision.findMany).mockResolvedValue([{ id: 'r-old1' }, { id: 'r-old2' }] as never)

    await writeWikiPageRevision(prisma, revision({ action: 'created' }), NOW)

    expect(vi.mocked(prisma.wikiPageRevision.findMany).mock.calls[0][0]).toMatchObject({
      where: { pageId: 'p1' },
      orderBy: { number: 'desc' },
      skip: 3,
    })
    expect(prisma.wikiPageRevision.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['r-old1', 'r-old2'] } } })
  })

  it('上限内なら消さない', async () => {
    await writeWikiPageRevision(prisma, revision({ action: 'created' }), NOW)
    expect(prisma.wikiPageRevision.deleteMany).not.toHaveBeenCalled()
  })

  it('まとめたときは件数が増えないので数えない', async () => {
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue(latest() as never)
    await writeWikiPageRevision(prisma, revision(), NOW)
    expect(prisma.wikiPageRevision.findMany).not.toHaveBeenCalled()
  })
})

/** 一覧の行(本文なし)。`updatedAt` は NOW からの日数で指定する */
const summaryRow = (id: string, daysAgo: number, override: Record<string, unknown> = {}) => ({
  id,
  pageId: 'p1',
  number: 1,
  action: 'updated',
  parentId: null,
  order: 0,
  title: 'タイトル',
  tags: [],
  via: 'web',
  restoredFromId: null,
  createdAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
  updatedAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
  actor: { name: '利用者', isAgent: false },
  ticket: null,
  ...override,
})

/** 版に紐づくチケット */
const ticketOf = (id: string, number: number) => ({ ticket: { id, number, board: { key: 'PRIV' } } })

/** 閲覧者が見られるチケットだけを返す */
const viewableTickets = (...ids: string[]) => mockViewableTickets((id) => ids.includes(id))

/** チケットの閲覧可否を引いた ID */
const askedTicketIds = () =>
  vi.mocked(prisma.ticket.findMany).mock.calls.map(([args]) => (args?.where?.id as { in: string[] }).in)

describe('listWikiPageRevisions', () => {
  it('存在するページのスペースで閲覧権限を確かめ、本文なしで新しい順に返す', async () => {
    const pageUpdatedAt = new Date('2026-11-08T09:00:00.000Z')
    vi.mocked(prisma.wikiPage.findUnique)
      .mockResolvedValueOnce({ spaceId: 's1' } as never)
      .mockResolvedValueOnce({ updatedAt: pageUpdatedAt } as never)
    vi.mocked(prisma.wikiPageRevision.findMany).mockResolvedValue([
      summaryRow('r2', 1, {
        ticket: { id: 't5', number: 5, board: { key: 'DEV' } },
        tags: [
          { id: 't1', name: '設計' },
          { id: 't9', name: '削除済み' },
        ],
      }),
      summaryRow('r1', 8, { actor: null }),
    ] as never)

    const { revisions: list, pageUpdatedAt: at } = await listWikiPageRevisions({ id: 'u1' }, 'p1', NOW)

    expect(assertWikiSpaceAccess).toHaveBeenCalledWith({ id: 'u1' }, 's1', 'view')
    const args = vi.mocked(prisma.wikiPageRevision.findMany).mock.calls[0][0]
    expect(args).toMatchObject({ where: { pageId: 'p1' }, orderBy: { number: 'desc' } })
    expect(args?.select).not.toHaveProperty('content')
    expect(list.map(({ id, beforeRetention }) => [id, beforeRetention])).toEqual([
      ['r2', false],
      ['r1', true],
    ])
    expect(list[0]).toMatchObject({
      ticketDisplayId: 'DEV-5',
      actorName: '利用者',
      tags: [
        { id: 't1', name: '設計' },
        { id: 't9', name: '削除済み' },
      ],
    })
    expect(list[0], 'タグの列はそのまま出さない').not.toHaveProperty('tagIds')
    expect(list[1]).toMatchObject({ ticketDisplayId: null, actorName: '', actorIsAgent: false })
    expect(at).toEqual(pageUpdatedAt)
  })

  it('閲覧者が見られないチケットの表示ID は返さない。判定は重複を除いて 1 回のクエリで行う', async () => {
    vi.mocked(prisma.wikiPage.findUnique).mockResolvedValue({ spaceId: 's1' } as never)
    vi.mocked(prisma.wikiPageRevision.findMany).mockResolvedValue([
      summaryRow('r3', 1, ticketOf('t-open', 1)),
      summaryRow('r2', 2, ticketOf('t-hidden', 2)),
      summaryRow('r1', 3, ticketOf('t-open', 1)),
    ] as never)
    viewableTickets('t-open')

    const { revisions } = await listWikiPageRevisions({ id: 'u1' }, 'p1', NOW)

    expect(revisions.map(({ ticketDisplayId }) => ticketDisplayId)).toEqual(['PRIV-1', null, 'PRIV-1'])
    expect(askedTicketIds()).toEqual([['t-open', 't-hidden']])
    // getTicketAccess の canView と同じく、ボードのメンバーか担当エージェントの承認者なら見られる
    expect(vi.mocked(prisma.ticket.findMany).mock.calls[0][0]?.where).toMatchObject({
      OR: [
        { board: { OR: [{ members: { some: { userId: 'u1' } } }, expect.anything()] } },
        { assignee: { isAgent: true } },
      ],
    })
    expect(revisions[0]).not.toHaveProperty('ticket')
  })

  it('チケットの無い版だけなら判定しない', async () => {
    vi.mocked(prisma.wikiPage.findUnique).mockResolvedValue({ spaceId: 's1' } as never)
    vi.mocked(prisma.wikiPageRevision.findMany).mockResolvedValue([summaryRow('r1', 1)] as never)
    await listWikiPageRevisions({ id: 'u1' }, 'p1', NOW)
    expect(prisma.ticket.findMany).not.toHaveBeenCalled()
  })

  it('ページの更新日時は版の一覧と同じスナップショットで読む', async () => {
    vi.mocked(prisma.wikiPage.findUnique).mockResolvedValue({ spaceId: 's1' } as never)
    vi.mocked(prisma.wikiPageRevision.findMany).mockResolvedValue([] as never)
    await listWikiPageRevisions({ id: 'u1' }, 'p1', NOW)
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Array), { isolationLevel: 'RepeatableRead' })
    expect(prisma.wikiPage.findUnique).toHaveBeenLastCalledWith({
      where: { id: 'p1', deletedAt: null },
      select: { updatedAt: true },
    })
  })

  it('保持期間は WIKI_REVISION_RETENTION_DAYS に従う', async () => {
    settings.retention = 30
    vi.mocked(prisma.wikiPage.findUnique).mockResolvedValue({ spaceId: 's1' } as never)
    vi.mocked(prisma.wikiPageRevision.findMany).mockResolvedValue([summaryRow('r1', 8)] as never)
    expect((await listWikiPageRevisions({ id: 'u1' }, 'p1', NOW)).revisions[0].beforeRetention).toBe(false)
  })

  it('削除済みのページも版を引け、ページの更新日時は null', async () => {
    vi.mocked(prisma.wikiPage.findUnique)
      .mockResolvedValueOnce({ spaceId: 's2' } as never)
      .mockResolvedValueOnce(null)
    vi.mocked(prisma.wikiPageRevision.findMany).mockResolvedValue([] as never)
    expect((await listWikiPageRevisions({ id: 'u1' }, 'p1', NOW)).pageUpdatedAt).toBeNull()
    expect(assertWikiSpaceAccess).toHaveBeenCalledWith({ id: 'u1' }, 's2', 'view')
    // スペースは削除済みを含めて引く
    expect(vi.mocked(prisma.wikiPage.findUnique).mock.calls[0][0]).toEqual({
      where: { id: 'p1' },
      select: { spaceId: true },
    })
  })

  it('ページが無ければエラー', async () => {
    vi.mocked(prisma.wikiPage.findUnique).mockResolvedValue(null)
    await expect(listWikiPageRevisions({ id: 'u1' }, 'p1', NOW)).rejects.toMatchObject({
      errorType: 'INVALID_OPERATION',
    })
  })
})

describe('getWikiPageRevisionContent', () => {
  it('閲覧権限を確かめて版の本文を返す', async () => {
    vi.mocked(prisma.wikiPageRevision.findUnique).mockResolvedValue({ spaceId: 's1', content: '本文' } as never)

    expect(await getWikiPageRevisionContent({ id: 'u1' }, 'r2')).toBe('本文')
    expect(assertWikiSpaceAccess).toHaveBeenCalledWith({ id: 'u1' }, 's1', 'view')
  })

  it('版が無ければエラー', async () => {
    vi.mocked(prisma.wikiPageRevision.findUnique).mockResolvedValue(null)
    await expect(getWikiPageRevisionContent({ id: 'u1' }, 'r2')).rejects.toThrow()
    expect(assertWikiSpaceAccess).not.toHaveBeenCalled()
  })
})

describe('getWikiPageRevisionSnapshot', () => {
  it('閲覧権限を確かめて、版の内容と本文を返す。タグはいまスペースに残っているものを ID で引き、改名後の名前で返す', async () => {
    vi.mocked(prisma.wikiPageRevision.findUnique).mockResolvedValue({
      // t1 は版の後で「旧設計」から「設計」に改名、t9 は削除済み
      ...summaryRow('r2', 1, {
        number: 3,
        type: 'design_doc',
        tags: [
          { id: 't1', name: '旧設計' },
          { id: 't9', name: '削除済み' },
        ],
      }),
      spaceId: 's1',
      content: '本文',
    } as never)
    const tag = { id: 't1', name: '設計', color: 'blue', order: 0 } as const
    vi.mocked(listWikiTags).mockResolvedValue([tag, { id: 't2', name: '運用', color: 'red', order: 1 }])

    const result = await getWikiPageRevisionSnapshot({ id: 'u1' }, 'p1', 'r2', NOW)
    expect(assertWikiSpaceAccess).toHaveBeenCalledWith({ id: 'u1' }, 's1', 'view')
    expect(listWikiTags).toHaveBeenCalledWith('s1')
    expect(result).toMatchObject({
      id: 'r2',
      number: 3,
      type: 'design_doc',
      tags: [tag],
      content: '本文',
      actorName: '利用者',
      beforeRetention: false,
    })
    expect(result).not.toHaveProperty('spaceId')
  })

  it.each([
    ['見られる', 'PRIV-7', true],
    ['見られない', null, false],
  ])('閲覧者が%sチケットの表示ID は %j', async (_, expected, canView) => {
    vi.mocked(prisma.wikiPageRevision.findUnique).mockResolvedValue({
      ...summaryRow('r2', 1, ticketOf('t7', 7)),
      spaceId: 's1',
      content: '本文',
    } as never)
    vi.mocked(listWikiTags).mockResolvedValue([])
    viewableTickets(...(canView ? ['t7'] : []))

    const result = await getWikiPageRevisionSnapshot({ id: 'u1' }, 'p1', 'r2', NOW)
    expect(result.ticketDisplayId).toBe(expected)
    expect(askedTicketIds()).toEqual([['t7']])
  })

  it('別のページの版はエラー', async () => {
    vi.mocked(prisma.wikiPageRevision.findUnique).mockResolvedValue({
      ...summaryRow('r2', 1, { pageId: 'p-other' }),
      spaceId: 's1',
      content: '本文',
    } as never)
    await expect(getWikiPageRevisionSnapshot({ id: 'u1' }, 'p1', 'r2', NOW)).rejects.toThrow()
    expect(assertWikiSpaceAccess).not.toHaveBeenCalled()
  })

  it('版が無ければエラー', async () => {
    vi.mocked(prisma.wikiPageRevision.findUnique).mockResolvedValue(null)
    await expect(getWikiPageRevisionSnapshot({ id: 'u1' }, 'p1', 'r2', NOW)).rejects.toThrow()
  })

  it('閲覧権限が無ければエラー', async () => {
    vi.mocked(prisma.wikiPageRevision.findUnique).mockResolvedValue({
      ...summaryRow('r2', 1),
      spaceId: 's1',
      content: '本文',
    } as never)
    vi.mocked(assertWikiSpaceAccess).mockRejectedValue(new Error('denied'))
    await expect(getWikiPageRevisionSnapshot({ id: 'u1' }, 'p1', 'r2', NOW)).rejects.toThrow()
  })
})

describe('deleteWikiPageRevision', () => {
  const found = () =>
    vi
      .mocked(prisma.wikiPageRevision.findUnique)
      .mockResolvedValueOnce({ spaceId: 's1' } as never)
      .mockResolvedValueOnce({ pageId: 'p1' } as never)
  const owner = { key: 'DOCS', canView: true, canManage: true, archived: false }

  beforeEach(() => {
    vi.mocked(assertWikiSpaceAccess).mockResolvedValue(owner as never)
  })

  it('管理権限を確かめ、最新でない版を消す', async () => {
    found()
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue({ id: 'r-latest' } as never)

    await deleteWikiPageRevision({ id: 'u1' }, 'r2')
    expect(prisma.$queryRaw).toHaveBeenCalled()
    expect(assertWikiSpaceAccess).toHaveBeenCalledWith({ id: 'u1' }, 's1', 'manage', prisma)
    expect(vi.mocked(prisma.wikiPageRevision.findFirst).mock.calls[0][0]).toMatchObject({
      where: { pageId: 'p1' },
      orderBy: { number: 'desc' },
    })
    expect(prisma.wikiPageRevision.deleteMany).toHaveBeenCalledWith({ where: { id: 'r2' } })
  })

  it('最新の版は消せない', async () => {
    found()
    vi.mocked(prisma.wikiPageRevision.findFirst).mockResolvedValue({ id: 'r2' } as never)

    await expect(deleteWikiPageRevision({ id: 'u1' }, 'r2')).rejects.toThrow()
    expect(prisma.wikiPageRevision.deleteMany).not.toHaveBeenCalled()
  })

  it.each([
    ['アーカイブ済み', { archived: true }],
    ['本文を読めない管理者', { canView: false }],
  ])('%s は消せない', async (_, access) => {
    vi.mocked(prisma.wikiPageRevision.findUnique).mockResolvedValueOnce({ spaceId: 's1' } as never)
    vi.mocked(assertWikiSpaceAccess).mockResolvedValueOnce({ ...owner, ...access } as never)

    await expect(deleteWikiPageRevision({ id: 'u1' }, 'r2')).rejects.toThrow()
    expect(prisma.wikiPageRevision.deleteMany).not.toHaveBeenCalled()
  })

  it('管理権限が無ければ(編集者でも)消さない', async () => {
    vi.mocked(prisma.wikiPageRevision.findUnique).mockResolvedValueOnce({ spaceId: 's1' } as never)
    vi.mocked(assertWikiSpaceAccess).mockRejectedValueOnce(new Error('forbidden'))

    await expect(deleteWikiPageRevision({ id: 'u1' }, 'r2')).rejects.toThrow('forbidden')
    expect(prisma.wikiPageRevision.deleteMany).not.toHaveBeenCalled()
  })

  it('ロックを取った後に版が消えていれば何もしない', async () => {
    vi.mocked(prisma.wikiPageRevision.findUnique)
      .mockResolvedValueOnce({ spaceId: 's1' } as never)
      .mockResolvedValueOnce(null)

    await deleteWikiPageRevision({ id: 'u1' }, 'r2')
    expect(prisma.wikiPageRevision.deleteMany).not.toHaveBeenCalled()
  })

  it('版が無ければエラー', async () => {
    vi.mocked(prisma.wikiPageRevision.findUnique).mockResolvedValue(null)
    await expect(deleteWikiPageRevision({ id: 'u1' }, 'r2')).rejects.toThrow()
    expect(assertWikiSpaceAccess).not.toHaveBeenCalled()
  })
})

describe('listDeletedWikiPages', () => {
  /** 削除済みのページの行。`daysAgo` は削除した日時 */
  const deletedRow = (id: string, number: number, daysAgo: number, override: Record<string, unknown> = {}) => ({
    id,
    parentId: null,
    number,
    order: 0,
    title: id,
    type: 'page',
    deletedAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
    deletedBy: { name: '削除した人', isAgent: false },
    ...override,
  })
  /** 1回目に削除済みのページ、2回目に生きているページを返す */
  const mockPages = (deleted: object[], alive: object[]) =>
    vi
      .mocked(prisma.wikiPage.findMany)
      .mockResolvedValueOnce(deleted as never)
      .mockResolvedValueOnce(alive as never)

  it('削除済みのページを引き、削除した人・日時と、削除の版の経路を返す', async () => {
    mockPages([deletedRow('gone', 3, 1)], [])
    vi.mocked(prisma.wikiPageRevision.findMany).mockResolvedValue([{ pageId: 'gone', via: 'mcp' }] as never)

    const list = await listDeletedWikiPages({ id: 'u1' }, 's1')

    expect(assertWikiSpaceAccess).toHaveBeenCalledWith({ id: 'u1' }, 's1', 'view')
    const [deletedArgs, aliveArgs] = vi.mocked(prisma.wikiPage.findMany).mock.calls.map(([args]) => args)
    expect(deletedArgs).toMatchObject({ where: { spaceId: 's1', deletedAt: { not: null } } })
    expect(aliveArgs).toMatchObject({ where: { spaceId: 's1', deletedAt: null } })
    expect(vi.mocked(prisma.wikiPageRevision.findMany).mock.calls[0][0]).toMatchObject({
      where: { pageId: { in: ['gone'] } },
      distinct: ['pageId'],
    })
    expect(list).toEqual([
      {
        id: 'gone',
        number: 3,
        ref: 'DOCS/3',
        title: 'gone',
        type: 'page',
        deletedAt: new Date(NOW.getTime() - 86_400_000),
        deletedByName: '削除した人',
        deletedByIsAgent: false,
        via: 'mcp',
        depth: 0,
        parent: { state: 'root' },
      },
    ])
  })

  it('元の親を子より先に並べ、段数と元の親の状態を付ける', async () => {
    // 削除した日時の新しい順: 子 c1 / 親 p / 孫 g / 親の残る x / 直下の r / 子 c2
    mockPages(
      [
        deletedRow('c1', 2, 1, { parentId: 'p', order: 1, title: '子1' }),
        deletedRow('p', 1, 1, { parentId: 'top', title: '親' }),
        deletedRow('g', 4, 1, { parentId: 'c1', title: '孫' }),
        deletedRow('x', 5, 2, { parentId: 'mid', title: 'X' }),
        deletedRow('r', 7, 4, { title: 'R' }),
        deletedRow('c2', 3, 5, { parentId: 'p', order: 0, title: '子2' }),
      ],
      [
        { id: 'top', parentId: null, title: 'トップ' },
        { id: 'mid', parentId: 'top', title: '中間' },
      ],
    )

    const list = await listDeletedWikiPages({ id: 'u1' }, 's1')

    expect(list.map(({ id, depth, parent }) => [id, depth, parent])).toEqual([
      ['p', 0, { state: 'alive', path: ['トップ'] }],
      ['c2', 1, { state: 'deleted', pageId: 'p', title: '親' }],
      ['c1', 1, { state: 'deleted', pageId: 'p', title: '親' }],
      ['g', 2, { state: 'deleted', pageId: 'c1', title: '子1' }],
      ['x', 0, { state: 'alive', path: ['トップ', '中間'] }],
      ['r', 0, { state: 'root' }],
    ])
  })

  it('削除済みのページが無ければ、生きているページと版を引かない', async () => {
    vi.mocked(prisma.wikiPage.findMany).mockResolvedValue([])
    expect(await listDeletedWikiPages({ id: 'u1' }, 's1')).toEqual([])
    expect(prisma.wikiPage.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.wikiPageRevision.findMany).not.toHaveBeenCalled()
  })
})
