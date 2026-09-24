/**
 * ダッシュボードのメンション・最近更新されたチケット Widget の取得条件。
 * prisma と認可の問い合わせだけ差し替え、見えないボードのものを出さないことは
 * 可視スコープが本人の getAccessibleBoardIds の結果だけになることで確かめる。
 */

import { listMentions, listRecentActivity, MENTIONS_LIMIT, RECENT_ACTIVITY_LIMIT } from '@/lib/board/activity-widget'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { ticket: { findMany: vi.fn() }, ticketComment: { findMany: vi.fn() } },
}))

vi.mock('@/lib/board/board', () => ({
  ensurePrivateBoard: vi.fn(),
  getAccessibleBoardIds: vi.fn(),
}))

const { ensurePrivateBoard, getAccessibleBoardIds } = await import('@/lib/board/board')

const userId = '019e0000-0000-7000-8000-00000000000a'
const accessibleBoardId = '019e0000-0000-7000-8000-000000000001'
const scope = { boardId: { in: [accessibleBoardId] } }

type Args = { where: { AND: unknown[] } | Record<string, unknown>; take: number }
const ticketArgs = () => vi.mocked(prisma.ticket.findMany).mock.calls.at(-1)?.[0] as Args
const commentArgs = () => vi.mocked(prisma.ticketComment.findMany).mock.calls.at(-1)?.[0] as Args

const ticketRow = (id: string, number: number, updatedAt: string) => ({
  id,
  number,
  title: `title ${number}`,
  status: 'todo',
  dueDate: null,
  board: { key: 'ABC' },
  updatedAt: new Date(updatedAt),
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(ensurePrivateBoard).mockResolvedValue(accessibleBoardId)
  vi.mocked(getAccessibleBoardIds).mockResolvedValue([accessibleBoardId])
  vi.mocked(prisma.ticket.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.ticketComment.findMany).mockResolvedValue([] as never)
})

describe('listMentions', () => {
  it('チケット本文・コメントのどちらも可視ボードだけに絞り、自分宛てのものを上限付きで引く', async () => {
    await listMentions(userId)

    const mentioned = { mentionedUserIds: { has: userId } }
    expect(ticketArgs().where).toEqual({ AND: [scope, mentioned] })
    expect(ticketArgs().take).toBe(MENTIONS_LIMIT)
    const commentAnd = (commentArgs().where as { AND: unknown[] }).AND
    expect(commentAnd).toContainEqual(mentioned)
    expect(commentAnd).toContainEqual({ ticket: scope })
    expect(commentArgs().take).toBe(MENTIONS_LIMIT)
    expect(getAccessibleBoardIds).toHaveBeenCalledWith(userId)
  })

  it('可視ボードが無ければ 0 件になる条件で引く', async () => {
    vi.mocked(getAccessibleBoardIds).mockResolvedValueOnce([])

    await listMentions(userId)

    const empty = { boardId: { in: [] } }
    expect((ticketArgs().where as { AND: unknown[] }).AND).toContainEqual(empty)
    expect((commentArgs().where as { AND: unknown[] }).AND).toContainEqual({ ticket: empty })
  })

  it('自分が書いたコメントは除く(退会ユーザーのコメントは残す)', async () => {
    await listMentions(userId)

    expect((commentArgs().where as { AND: unknown[] }).AND).toContainEqual({
      OR: [{ authorId: null }, { authorId: { not: userId } }],
    })
  })

  it('本文とコメントを日時の新しい順にまとめ、上限で切る', async () => {
    const { updatedAt: _, ...commentTicket } = ticketRow('t9', 9, '2026-01-01T00:00:00Z')
    vi.mocked(prisma.ticket.findMany).mockResolvedValueOnce([
      ticketRow('t1', 1, '2026-09-20T00:00:00Z'),
      ticketRow('t2', 2, '2026-09-10T00:00:00Z'),
    ] as never)
    vi.mocked(prisma.ticketComment.findMany).mockResolvedValueOnce(
      Array.from({ length: MENTIONS_LIMIT }, (_, i) => ({
        id: `c${i}`,
        createdAt: new Date(`2026-09-${String(19 - i).padStart(2, '0')}T00:00:00Z`),
        author: i === 0 ? null : { name: 'someone' },
        ticket: commentTicket,
      })) as never,
    )

    const items = await listMentions(userId)

    expect(items).toHaveLength(MENTIONS_LIMIT)
    expect(items.map((item) => item.key).slice(0, 3)).toEqual(['ticket:t1', 'comment:c0', 'comment:c1'])
    expect(items.map((item) => item.key)).not.toContain('ticket:t2')
    expect(items[0]).toMatchObject({ kind: 'ticket', href: '/t/ABC-1', authorName: null })
    expect(items[1]).toMatchObject({ kind: 'comment', href: '/t/ABC-9#comment-c0', authorName: null })
    expect(items[2]).toMatchObject({ authorName: 'someone', ticket: { displayId: 'ABC-9' } })
  })
})

describe('listRecentActivity', () => {
  it('可視ボードだけに絞り、更新日時の新しい順に上限付きで引く', async () => {
    await listRecentActivity(userId)

    const args = vi.mocked(prisma.ticket.findMany).mock.calls.at(-1)?.[0]
    expect(args?.where).toEqual(scope)
    expect(args?.orderBy).toEqual([{ updatedAt: 'desc' }, { id: 'desc' }])
    expect(args?.take).toBe(RECENT_ACTIVITY_LIMIT)
  })

  it('可視ボードが無ければ 0 件になる条件で引く', async () => {
    vi.mocked(getAccessibleBoardIds).mockResolvedValueOnce([])

    await listRecentActivity(userId)

    expect(ticketArgs().where).toEqual({ boardId: { in: [] } })
  })

  it('表示ID をボードキーと番号から組み立てる', async () => {
    vi.mocked(prisma.ticket.findMany).mockResolvedValueOnce([ticketRow('t1', 12, '2026-09-20T00:00:00Z')] as never)

    expect(await listRecentActivity(userId)).toEqual([
      {
        id: 't1',
        displayId: 'ABC-12',
        title: 'title 12',
        status: 'todo',
        dueDate: null,
        updatedAt: new Date('2026-09-20T00:00:00Z'),
      },
    ])
  })
})
