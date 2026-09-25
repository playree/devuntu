/**
 * ダッシュボードのチケット系 Widget の取得条件。
 * prisma と認可の問い合わせだけ差し替え、buildTicketWhere は実物を通して where を確かめる。
 * 他人のボードのチケットを出さないことは、可視スコープが本人の getAccessibleBoardIds の結果だけになることで確かめる。
 */

import { countMyTicketsByStatus, listDueSoonTickets, listMyTickets, MY_TICKETS_LIMIT } from '@/lib/board/ticket-widget'
import { prisma } from '@/lib/prisma'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { ticket: { findMany: vi.fn(), groupBy: vi.fn(), count: vi.fn() } },
}))

vi.mock('@/lib/board/board', () => ({
  ensurePrivateBoard: vi.fn(),
}))

vi.mock('@/lib/board/board-access', () => ({
  getAccessibleBoardIds: vi.fn(),
}))

const { ensurePrivateBoard } = await import('@/lib/board/board')
const { getAccessibleBoardIds } = await import('@/lib/board/board-access')

const userId = '019e0000-0000-7000-8000-00000000000a'
const accessibleBoardId = '019e0000-0000-7000-8000-000000000001'

type Where = { AND?: Where[]; [key: string]: unknown }

/** buildTicketWhere が AND の先頭に積む可視スコープ。外側で AND に包んでいても辿って取り出す */
const scopeOf = (where: Where): unknown => {
  const head = where.AND?.[0]
  if (!head) {
    return undefined
  }
  return 'boardId' in head ? head : scopeOf(head)
}

const lastFindManyArgs = () =>
  vi.mocked(prisma.ticket.findMany).mock.calls.at(-1)?.[0] as { where: Where; take: number }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(ensurePrivateBoard).mockResolvedValue(accessibleBoardId)
  vi.mocked(getAccessibleBoardIds).mockResolvedValue([accessibleBoardId])
  vi.mocked(prisma.ticket.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.ticket.groupBy).mockResolvedValue([] as never)
  vi.mocked(prisma.ticket.count).mockResolvedValue(0 as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('listMyTickets', () => {
  it('可視ボードだけに絞り、担当が自分の未完了チケットを上限付きで引く', async () => {
    await listMyTickets(userId)

    const { where, take } = lastFindManyArgs()
    expect(scopeOf(where)).toEqual({ boardId: { in: [accessibleBoardId] } })
    expect(where.AND).toContainEqual({ assigneeId: userId })
    expect(where.AND).toContainEqual({ status: { in: ['backlog', 'todo', 'doing'] } })
    expect(take).toBe(MY_TICKETS_LIMIT)
    expect(getAccessibleBoardIds).toHaveBeenCalledWith(userId)
  })

  it('可視ボードが無ければ 0 件になる条件で引く', async () => {
    vi.mocked(getAccessibleBoardIds).mockResolvedValueOnce([])

    await listMyTickets(userId)

    expect(scopeOf(lastFindManyArgs().where)).toEqual({ boardId: { in: [] } })
  })

  it('表示ID をボードキーと番号から組み立てる', async () => {
    vi.mocked(prisma.ticket.findMany).mockResolvedValueOnce([
      { id: 't1', number: 12, title: 'a', status: 'todo', priority: 'high', dueDate: null, board: { key: 'ABC' } },
    ] as never)

    expect(await listMyTickets(userId)).toEqual([
      { id: 't1', displayId: 'ABC-12', title: 'a', status: 'todo', priority: 'high', dueDate: null },
    ])
  })
})

describe('listDueSoonTickets', () => {
  it('可視ボードだけに絞り、期日が未設定のチケットは含めない', async () => {
    await listDueSoonTickets(userId, 'Asia/Tokyo')

    const { where } = lastFindManyArgs()
    expect(scopeOf(where)).toEqual({ boardId: { in: [accessibleBoardId] } })
    expect(where.AND?.[1]).toMatchObject({ dueDate: { not: null } })
  })

  it('期日の上限はユーザーの TZ での今日 + 7 日(UTC 0:00)', async () => {
    vi.useFakeTimers()
    // UTC では 9/24 だが、東京では 9/25 になっている時刻
    vi.setSystemTime(new Date('2026-09-24T16:00:00Z'))

    await listDueSoonTickets(userId, 'Asia/Tokyo')
    expect(lastFindManyArgs().where.AND?.[1]).toEqual({
      dueDate: { lte: new Date('2026-10-02T00:00:00Z'), not: null },
    })

    await listDueSoonTickets(userId, 'UTC')
    expect(lastFindManyArgs().where.AND?.[1]).toEqual({
      dueDate: { lte: new Date('2026-10-01T00:00:00Z'), not: null },
    })
  })
})

describe('countMyTicketsByStatus', () => {
  it('集計・完了件数のどちらも可視ボードだけに絞る', async () => {
    await countMyTicketsByStatus(userId)

    const groupWhere = vi.mocked(prisma.ticket.groupBy).mock.calls[0]?.[0]?.where as Where
    const countWhere = vi.mocked(prisma.ticket.count).mock.calls[0]?.[0]?.where as Where
    for (const where of [groupWhere, countWhere]) {
      expect(scopeOf(where)).toEqual({ boardId: { in: [accessibleBoardId] } })
    }
  })

  it('完了は直近 7 日に完了したものだけを数える', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T12:00:00Z'))

    await countMyTicketsByStatus(userId)

    const countWhere = vi.mocked(prisma.ticket.count).mock.calls[0]?.[0]?.where as Where
    expect(countWhere.AND?.[1]).toEqual({ completedAt: { gte: new Date('2026-09-17T12:00:00Z') } })
  })

  it('件数の無いステータスは 0 で埋める', async () => {
    vi.mocked(prisma.ticket.groupBy).mockResolvedValueOnce([{ status: 'doing', _count: { _all: 3 } }] as never)
    vi.mocked(prisma.ticket.count).mockResolvedValueOnce(2 as never)

    expect(await countMyTicketsByStatus(userId)).toEqual({ backlog: 0, todo: 0, doing: 3, done: 2 })
  })
})
