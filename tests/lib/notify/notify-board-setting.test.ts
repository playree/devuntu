/**
 * ボードごとのチャネル通知設定の単体テスト
 *
 * 画面では「通知先 1 つ + イベントの ON/OFF」として扱い、保存は総入れ替え。
 * 行の作り方と、チャネル通知を持たないイベントを保存しないことを固定する。
 */

import type { Prisma } from '@/generated/prisma/client'
import { CHANNEL_NOTIFY_EVENTS } from '@/lib/notify/notify'
import { getBoardNotifyChannels, getBoardNotifySetting, setBoardNotifySetting } from '@/lib/notify/notify-board-setting'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({ boardNotifySetting: ['findMany', 'deleteMany', 'createMany'] }),
)

const findMany = vi.mocked(prisma.boardNotifySetting.findMany)
const deleteMany = vi.mocked(prisma.boardNotifySetting.deleteMany)
const createMany = vi.mocked(prisma.boardNotifySetting.createMany)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getBoardNotifySetting', () => {
  it('行が無ければ通知先なし・イベントなし', async () => {
    findMany.mockResolvedValue([])

    expect(await getBoardNotifySetting('b1')).toEqual({ slackChannelId: null, events: [] })
  })

  it('ON のイベントを定義順で返し、通知先は最初の行のものに揃える', async () => {
    findMany.mockResolvedValue([
      { event: 'ticket_completed', slackChannelId: 'C0000000A' },
      { event: 'agent_run', slackChannelId: 'C0000000B' },
    ] as never)

    expect(await getBoardNotifySetting('b1')).toEqual({
      slackChannelId: 'C0000000A',
      events: ['agent_run', 'ticket_completed'],
    })
  })

  it('チャネル通知を持たないイベントの行は events に出さない', async () => {
    findMany.mockResolvedValue([{ event: 'mention', slackChannelId: 'C0000000A' }] as never)

    expect((await getBoardNotifySetting('b1')).events).toEqual([])
  })
})

describe('setBoardNotifySetting', () => {
  it('既存の行を消してから、ON のイベントごとに同じ通知先で作り直す', async () => {
    await setBoardNotifySetting('b1', { slackChannelId: 'C0000000A', events: ['ticket_created', 'agent_run'] })

    expect(deleteMany).toHaveBeenCalledWith({ where: { boardId: 'b1' } })
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { boardId: 'b1', event: 'agent_run', slackChannelId: 'C0000000A' },
        { boardId: 'b1', event: 'ticket_created', slackChannelId: 'C0000000A' },
      ],
    })
    expect(deleteMany.mock.invocationCallOrder[0]).toBeLessThan(createMany.mock.invocationCallOrder[0])
  })

  it('チャネル通知を持たないイベントは保存しない', async () => {
    await setBoardNotifySetting('b1', { slackChannelId: 'C0000000A', events: ['mention', 'agent_run'] })

    expect(createMany).toHaveBeenCalledWith({
      data: [{ boardId: 'b1', event: 'agent_run', slackChannelId: 'C0000000A' }],
    })
  })

  it.each<[string, { slackChannelId: string | null; events: (typeof CHANNEL_NOTIFY_EVENTS)[number][] }]>([
    ['通知先なし', { slackChannelId: null, events: ['agent_run'] }],
    ['通知先が空文字', { slackChannelId: '', events: ['agent_run'] }],
    ['イベントが 1 つも ON でない', { slackChannelId: 'C0000000A', events: [] }],
  ])('%s なら行を全部消すだけ(通知しない)', async (_label, setting) => {
    await setBoardNotifySetting('b1', setting)

    expect(deleteMany).toHaveBeenCalledWith({ where: { boardId: 'b1' } })
    expect(createMany).not.toHaveBeenCalled()
  })

  it('チャネル通知を持たないイベントだけなら行を作らない', async () => {
    await setBoardNotifySetting('b1', { slackChannelId: 'C0000000A', events: ['mention'] })

    expect(createMany).not.toHaveBeenCalled()
  })

  it('トランザクションを渡されたらそちらで書く', async () => {
    const tx = { boardNotifySetting: { deleteMany: vi.fn(), createMany: vi.fn() } }

    await setBoardNotifySetting(
      'b1',
      { slackChannelId: 'C0000000A', events: ['agent_run'] },
      tx as unknown as Prisma.TransactionClient,
    )

    expect(tx.boardNotifySetting.deleteMany).toHaveBeenCalled()
    expect(tx.boardNotifySetting.createMany).toHaveBeenCalled()
    expect(deleteMany).not.toHaveBeenCalled()
  })
})

describe('getBoardNotifyChannels', () => {
  it('ボードとイベントで引いたチャンネルIDを返す', async () => {
    findMany.mockResolvedValue([{ slackChannelId: 'C0000000A' }] as never)

    expect(await getBoardNotifyChannels('b1', 'ticket_created')).toEqual(['C0000000A'])
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { boardId: 'b1', event: 'ticket_created' } })
  })

  it('行が無ければ空(通知しない)', async () => {
    findMany.mockResolvedValue([])

    expect(await getBoardNotifyChannels('b1', 'agent_run')).toEqual([])
  })
})
