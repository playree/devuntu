/**
 * advisory lock のプロセス内の順番待ち
 *
 * ロック待ちがそれぞれ接続を握るとプールを使い切り、保持者が better-auth 用の接続を
 * 取れずに止まる。同じキーのトランザクションはプロセス内で1本ずつしか開かないことを確認する。
 */

import { ADVISORY_LOCK_KEYS, withAdvisoryLock } from '@/lib/advisory-lock'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: vi.fn() } }))

let open = 0
let maxOpen = 0

beforeEach(() => {
  vi.clearAllMocks()
  open = 0
  maxOpen = 0
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => Promise<unknown>) => {
    open += 1
    maxOpen = Math.max(maxOpen, open)
    try {
      return await fn({ $executeRaw: vi.fn() })
    } finally {
      open -= 1
    }
  }) as never)
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('withAdvisoryLock', () => {
  it('同じキーのトランザクションは同時に1本しか開かない', async () => {
    const order: string[] = []
    const task = (name: string) =>
      withAdvisoryLock(ADVISORY_LOCK_KEYS.adminRole, async () => {
        order.push(`${name}:start`)
        await sleep(10)
        order.push(`${name}:end`)
        return name
      })

    expect(await Promise.all([task('A'), task('B'), task('C')])).toEqual(['A', 'B', 'C'])
    expect(maxOpen).toBe(1)
    expect(order).toEqual(['A:start', 'A:end', 'B:start', 'B:end', 'C:start', 'C:end'])
  })

  it('前の処理が失敗しても後続は実行され、例外は失敗した呼び出し元にだけ返る', async () => {
    const failed = withAdvisoryLock(ADVISORY_LOCK_KEYS.adminRole, async () => {
      throw new Error('boom')
    })
    const next = withAdvisoryLock(ADVISORY_LOCK_KEYS.adminRole, async () => 'ok')

    await expect(failed).rejects.toThrow('boom')
    expect(await next).toBe('ok')
  })

  it('別のキーは互いに待たない', async () => {
    await Promise.all([
      withAdvisoryLock(ADVISORY_LOCK_KEYS.adminRole, () => sleep(10)),
      withAdvisoryLock(ADVISORY_LOCK_KEYS.initialSetup, () => sleep(10)),
    ])
    expect(maxOpen).toBe(2)
  })
})
