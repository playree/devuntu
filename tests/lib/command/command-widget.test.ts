/**
 * ダッシュボードの「最近のリモート実行」Widget の取得条件。
 * リモート実行を使えないユーザーには履歴を返さず、使えるユーザーにも本人の実行だけを返すことを固定する。
 */

import { COMMAND_RUNS_WIDGET_LIMIT, listMyRecentCommandRuns } from '@/lib/command/command-widget'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { commandRun: { findMany: vi.fn() } },
}))

vi.mock('@/lib/command/command-access', () => ({
  canUseAnyCommand: vi.fn(),
}))

const { canUseAnyCommand } = await import('@/lib/command/command-access')

const actor = { id: '019e0000-0000-7000-8000-00000000000a', role: 'user' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.commandRun.findMany).mockResolvedValue([])
})

describe('listMyRecentCommandRuns', () => {
  it('リモート実行を使えないユーザーには空を返し、履歴を引かない', async () => {
    vi.mocked(canUseAnyCommand).mockResolvedValue(false)

    await expect(listMyRecentCommandRuns(actor)).resolves.toEqual([])
    expect(canUseAnyCommand).toHaveBeenCalledWith(actor)
    expect(prisma.commandRun.findMany).not.toHaveBeenCalled()
  })

  it('使えるユーザーには本人の実行だけを新しい順に上限まで返す', async () => {
    vi.mocked(canUseAnyCommand).mockResolvedValue(true)

    await listMyRecentCommandRuns(actor)

    const args = vi.mocked(prisma.commandRun.findMany).mock.calls[0][0] as {
      where: unknown
      orderBy: unknown
      take: number
    }
    expect(args.where).toEqual({ userId: actor.id })
    expect(args.orderBy).toEqual([{ queuedAt: 'desc' }, { id: 'desc' }])
    expect(args.take).toBe(COMMAND_RUNS_WIDGET_LIMIT)
  })
})
