/**
 * プライベートボードの用意(ensurePrivateBoard)
 *
 * 並行呼び出しで create が競合しても、1 ユーザー 1 ボードに収束することを確かめる。
 */

import { ensurePrivateBoard } from '@/lib/board/board'
import { PRIVATE_BOARD_NAME } from '@/lib/board/ticket-id'
import { ClientError } from '@/lib/error'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakeTx = vi.hoisted(() => ({
  board: { create: vi.fn() },
  boardKeyHistory: { findMany: vi.fn(), create: vi.fn() },
}))

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({ board: ['findUnique'] }, { tx: fakeTx }),
)

const user = { id: 'u1' }
const uniqueViolation = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.board.findUnique).mockResolvedValue(null)
  fakeTx.boardKeyHistory.findMany.mockResolvedValue([])
  fakeTx.board.create.mockResolvedValue({ id: 'b-new' })
  fakeTx.boardKeyHistory.create.mockResolvedValue({ key: 'PRV1' })
})

describe('ensurePrivateBoard', () => {
  it('既にあればその ID を返し、作成しない', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue({ id: 'b-existing' } as never)
    expect(await ensurePrivateBoard(user)).toBe('b-existing')
    expect(prisma.board.findUnique).toHaveBeenCalledWith({ where: { privateOwnerId: 'u1' }, select: { id: true } })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('無ければ本人を owner にしたプライベートボードを作り、キーを履歴に登録する', async () => {
    expect(await ensurePrivateBoard(user)).toBe('b-new')
    expect(fakeTx.boardKeyHistory.findMany).toHaveBeenCalledWith({
      where: { key: { startsWith: 'PRV' } },
      select: { key: true },
    })
    expect(fakeTx.board.create).toHaveBeenCalledWith({
      data: {
        kind: 'private',
        privateOwnerId: 'u1',
        key: 'PRV1',
        name: PRIVATE_BOARD_NAME,
        members: { create: { userId: 'u1', role: 'owner' } },
      },
      select: { id: true },
    })
    expect(fakeTx.boardKeyHistory.create).toHaveBeenCalledWith({
      data: { key: 'PRV1', boardId: 'b-new' },
      select: { key: true },
    })
  })

  it('キーは履歴の最大の連番の次を採る', async () => {
    fakeTx.boardKeyHistory.findMany.mockResolvedValue([{ key: 'PRV1' }, { key: 'PRV3' }, { key: 'PRVX' }])
    await ensurePrivateBoard(user)
    expect(fakeTx.board.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ key: 'PRV4' }) }),
    )
  })

  it('一意制約違反のあと自分のボードが見つかれば、それを返す(同時作成の吸収)', async () => {
    vi.mocked(prisma.board.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'b-raced' } as never)
    fakeTx.board.create.mockRejectedValueOnce(uniqueViolation)

    expect(await ensurePrivateBoard(user)).toBe('b-raced')
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('キーの取り合いに負けて自分のボードが無ければ、採番からやり直す', async () => {
    fakeTx.board.create.mockRejectedValueOnce(uniqueViolation)

    expect(await ensurePrivateBoard(user)).toBe('b-new')
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(fakeTx.boardKeyHistory.findMany).toHaveBeenCalledTimes(2)
  })

  it('一意制約違反が 3 回続けば諦めてその例外を投げる', async () => {
    fakeTx.board.create.mockRejectedValue(uniqueViolation)

    await expect(ensurePrivateBoard(user)).rejects.toBe(uniqueViolation)
    expect(prisma.$transaction).toHaveBeenCalledTimes(3)
  })

  it('一意制約違反以外の例外はリトライも読み直しもせずに投げる', async () => {
    const error = new Error('connection lost')
    fakeTx.board.create.mockRejectedValueOnce(error)

    await expect(ensurePrivateBoard(user)).rejects.toBe(error)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.board.findUnique).toHaveBeenCalledTimes(1)
  })

  it('キーを採番しきれなければ作成せずに拒否する', async () => {
    fakeTx.boardKeyHistory.findMany.mockResolvedValue([{ key: 'PRV99999' }])

    await expect(ensurePrivateBoard(user)).rejects.toThrow(ClientError)
    expect(fakeTx.board.create).not.toHaveBeenCalled()
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })
})
