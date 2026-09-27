/**
 * ユーザーごとの通知設定の単体テスト
 *
 * 行が無い = OFF のオプトイン方式なので、「行が無いときに送らない」ことを固定する。
 */

import { DM_NOTIFY_EVENTS } from '@/lib/notify/notify'
import { filterNotifiable, getUserNotifySettings, setUserNotifySettings } from '@/lib/notify/notify-setting'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({ userNotifySetting: ['findMany', 'upsert'] }),
)

const findMany = vi.mocked(prisma.userNotifySetting.findMany)
const upsert = vi.mocked(prisma.userNotifySetting.upsert)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getUserNotifySettings', () => {
  it('行が無いイベントは全チャネル OFF で埋める', async () => {
    findMany.mockResolvedValue([])

    const settings = await getUserNotifySettings('u1')

    expect(Object.keys(settings)).toEqual([...DM_NOTIFY_EVENTS])
    for (const event of DM_NOTIFY_EVENTS) {
      expect(settings[event], event).toEqual({ email: false, slack: false, webpush: false })
    }
  })

  it('行があるイベントはその値を返す', async () => {
    findMany.mockResolvedValue([{ event: 'mention', email: true, slack: false, webpush: true }] as never)

    const settings = await getUserNotifySettings('u1')

    expect(settings.mention).toEqual({ email: true, slack: false, webpush: true })
    expect(settings.agent_run).toEqual({ email: false, slack: false, webpush: false })
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { userId: 'u1' } })
  })

  it('DM 通知でないイベントの行は返さない', async () => {
    findMany.mockResolvedValue([{ event: 'ticket_created', email: true, slack: true, webpush: true }] as never)

    expect(await getUserNotifySettings('u1')).not.toHaveProperty('ticket_created')
  })

  it('既定値はイベントごとに別オブジェクト(1 つを書き換えても他へ波及しない)', async () => {
    findMany.mockResolvedValue([])

    const settings = await getUserNotifySettings('u1')
    settings.mention.email = true

    expect(settings.agent_run.email).toBe(false)
  })
})

describe('setUserNotifySettings', () => {
  it('イベントごとに upsert し、1 トランザクションでまとめて反映する', async () => {
    upsert.mockImplementation((async (arg: unknown) => arg) as never)

    await setUserNotifySettings('u1', [
      { event: 'mention', email: true, slack: false, webpush: false },
      { event: 'agent_run', email: false, slack: true, webpush: true },
    ])

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls.map(([arg]) => arg)).toEqual([
      {
        where: { userId_event: { userId: 'u1', event: 'mention' } },
        update: { email: true, slack: false, webpush: false },
        create: { userId: 'u1', event: 'mention', email: true, slack: false, webpush: false },
      },
      {
        where: { userId_event: { userId: 'u1', event: 'agent_run' } },
        update: { email: false, slack: true, webpush: true },
        create: { userId: 'u1', event: 'agent_run', email: false, slack: true, webpush: true },
      },
    ])
  })

  it('途中の upsert が失敗したら例外をそのまま返す', async () => {
    upsert.mockRejectedValue(new Error('db down'))

    await expect(
      setUserNotifySettings('u1', [{ event: 'mention', email: true, slack: false, webpush: false }]),
    ).rejects.toThrow('db down')
  })
})

describe('filterNotifiable', () => {
  it('宛先が空なら引かずに空', async () => {
    expect(await filterNotifiable([], 'mention', 'email')).toEqual([])
    expect(findMany).not.toHaveBeenCalled()
  })

  it('指定チャネルが ON の行だけを引く', async () => {
    findMany.mockResolvedValue([])

    await filterNotifiable(['u1', 'u2'], 'mention', 'slack')

    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { userId: { in: ['u1', 'u2'] }, event: 'mention', slack: true },
    })
  })

  it('ON の行があるユーザーだけを、渡された順のまま残す', async () => {
    findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u3' }] as never)

    expect(await filterNotifiable(['u3', 'u2', 'u1'], 'mention', 'email')).toEqual(['u3', 'u1'])
  })

  it('行が無いユーザーは送らない(オプトイン)', async () => {
    findMany.mockResolvedValue([])

    expect(await filterNotifiable(['u1'], 'agent_run', 'webpush')).toEqual([])
  })
})
