/** マージによる自動完了の保留済みの判定(hasMergeHeld) */

import { hasMergeHeld } from '@/lib/board/ticket-activity'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({ ticketActivity: ['findFirst'] }),
)

const PR = 'owner/repo#12'
const findFirst = vi.mocked(prisma.ticketActivity.findFirst)

/** 1回目: 同じ PR の保留 / 2回目: 最新のステータス変更・保留 */
const mockActivities = (samePullRequest: boolean, latestField: 'status' | 'mergeHeld' | null) =>
  findFirst
    .mockResolvedValueOnce((samePullRequest ? { id: 'a1' } : null) as never)
    .mockResolvedValueOnce((latestField ? { field: latestField } : null) as never)

beforeEach(() => {
  findFirst.mockReset()
})

describe('hasMergeHeld', () => {
  it('同じ PR / MR で保留した記録があれば保留済み', async () => {
    mockActivities(true, 'status')

    expect(await hasMergeHeld(prisma as never, 't1', PR)).toBe(true)
    expect(findFirst).toHaveBeenCalledWith({
      where: { ticketId: 't1', field: 'mergeHeld', before: PR },
      select: { id: true },
    })
  })

  it('最後のステータス変更より後に別の PR / MR で保留していれば保留済み', async () => {
    mockActivities(false, 'mergeHeld')

    expect(await hasMergeHeld(prisma as never, 't1', PR)).toBe(true)
  })

  it('保留の後にステータスを変えていれば、別の PR / MR では保留し直す', async () => {
    mockActivities(false, 'status')

    expect(await hasMergeHeld(prisma as never, 't1', PR)).toBe(false)
  })

  it('履歴が無ければ保留していない', async () => {
    mockActivities(false, null)

    expect(await hasMergeHeld(prisma as never, 't1', PR)).toBe(false)
  })
})
