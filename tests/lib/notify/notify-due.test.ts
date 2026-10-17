/**
 * 期限のリマインドの単体テスト
 *
 * 送る時刻(宛先のタイムゾーンの 9:00)の境界と、投入しない条件を固定する。
 * 投入から先(宛先の絞り込み・送信)は別のテストで見る。
 */

import { DUE_REMIND_BATCH } from '@/lib/notify/notify'
import { dueRemindKind, runDueRemind } from '@/lib/notify/notify-due'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/notify/notify-enqueue', () => ({ enqueueNotify: vi.fn(async () => true) }))
vi.mock('@/lib/notify/notify-recipient', () => ({ ticketOwnerIds: vi.fn() }))
vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    ticket: ['findMany'],
    userNotifySetting: ['findMany'],
    ticketDueReminder: ['createMany'],
  }),
)

const { enqueueNotify } = await import('@/lib/notify/notify-enqueue')
const { ticketOwnerIds } = await import('@/lib/notify/notify-recipient')
const { prisma } = await import('@/lib/prisma')

const enqueue = vi.mocked(enqueueNotify)
const findTickets = vi.mocked(prisma.ticket.findMany)
const findSettings = vi.mocked(prisma.userNotifySetting.findMany)
const createReminder = vi.mocked(prisma.ticketDueReminder.createMany)
const ownerIds = vi.mocked(ticketOwnerIds)

const utc = (iso: string) => new Date(iso)
const day = (date: string) => new Date(`${date}T00:00:00Z`)

describe('dueRemindKind: 送る時刻と種類', () => {
  const TOKYO = 'Asia/Tokyo'

  it('9:00 より前は送らない', () => {
    // 2026-10-19 08:59 JST
    expect(dueRemindKind(day('2026-10-19'), utc('2026-10-18T23:59:00Z'), TOKYO)).toBeNull()
  })

  it('9:00 を過ぎたら、期限が今日なら当日・明日なら前日', () => {
    // 2026-10-19 09:00 JST
    const now = utc('2026-10-19T00:00:00Z')
    expect(dueRemindKind(day('2026-10-19'), now, TOKYO)).toBe('due_day')
    expect(dueRemindKind(day('2026-10-20'), now, TOKYO)).toBe('day_before')
  })

  it('期限が明後日以降・過去なら送らない(止まっていた間の分を後から送らない)', () => {
    const now = utc('2026-10-19T03:00:00Z')
    expect(dueRemindKind(day('2026-10-21'), now, TOKYO)).toBeNull()
    expect(dueRemindKind(day('2026-10-18'), now, TOKYO)).toBeNull()
  })

  it('今日・明日は宛先のタイムゾーンの暦日で決まる', () => {
    // 2026-10-19 16:00Z = 10-19 09:00 PDT = 10-20 01:00 JST
    const now = utc('2026-10-19T16:00:00Z')
    expect(dueRemindKind(day('2026-10-19'), now, 'America/Los_Angeles')).toBe('due_day')
    expect(dueRemindKind(day('2026-10-20'), now, TOKYO)).toBeNull()
  })

  it('夏時間の切り替え日も壁時計の 9:00 で送る', () => {
    // 2026-11-01 は米国の夏時間の終了日。9:00 EST = 14:00Z
    expect(dueRemindKind(day('2026-11-01'), utc('2026-11-01T13:59:00Z'), 'America/New_York')).toBeNull()
    expect(dueRemindKind(day('2026-11-01'), utc('2026-11-01T14:00:00Z'), 'America/New_York')).toBe('due_day')
  })
})

describe('runDueRemind', () => {
  // 2026-10-19 10:00 JST
  const NOW = utc('2026-10-19T01:00:00Z')

  const person = (id: string) => ({ id, isAgent: false, timezone: 'Asia/Tokyo' })
  const agent = (id: string) => ({ id, isAgent: true, timezone: null })

  const ticket = (overrides: Record<string, unknown> = {}) => ({
    id: 'ticket-1',
    boardId: 'board-1',
    number: 42,
    title: 'ログイン画面の崩れ',
    dueDate: day('2026-10-20'),
    board: { key: 'ABC' },
    assignee: person('user-assignee'),
    createdBy: person('user-creator'),
    dueReminders: [],
    ...overrides,
  })

  /** 受け取る設定を ON にしているユーザー */
  const remindable = (...userIds: string[]) =>
    findSettings.mockResolvedValue(userIds.map((userId) => ({ userId })) as never)

  const payloads = () => enqueue.mock.calls.map(([param]) => param.payload)

  beforeEach(() => {
    vi.clearAllMocks()
    createReminder.mockResolvedValue({ count: 1 })
    enqueue.mockResolvedValue(true)
    remindable('user-assignee', 'user-creator')
    // 配信側の宛先(閲覧権限込み)は、判定に使った宛先と食い違わない
    ownerIds.mockResolvedValue(['user-assignee', 'user-creator'])
  })

  it('完了済みとアーカイブ済みボードのチケットは引かない', async () => {
    findTickets.mockResolvedValue([])
    await runDueRemind(NOW)
    expect(findTickets.mock.calls[0][0]?.where).toMatchObject({
      status: { not: 'done' },
      board: { archived: false },
    })
  })

  it('担当者の今日・明日に当たるものを記録して投入する', async () => {
    findTickets.mockResolvedValue([ticket()] as never)
    expect(await runDueRemind(NOW)).toBe(1)
    expect(createReminder).toHaveBeenCalledWith({
      data: [{ ticketId: 'ticket-1', kind: 'day_before', dueDate: day('2026-10-20') }],
      skipDuplicates: true,
    })
    expect(enqueue.mock.calls[0][0].event).toBe('ticket_due')
    expect(payloads()).toEqual([
      {
        ticketId: 'ticket-1',
        boardId: 'board-1',
        displayId: 'ABC-42',
        ticketTitle: 'ログイン画面の崩れ',
        kind: 'day_before',
        dueDate: '2026-10-20',
      },
    ])
  })

  it('受け取る設定が無い宛先には記録も作らない(後から ON にすれば届く)', async () => {
    findTickets.mockResolvedValue([ticket()] as never)
    remindable('user-creator')
    expect(await runDueRemind(NOW)).toBe(0)
    expect(createReminder).not.toHaveBeenCalled()
  })

  it('担当がエージェント / 未割り当てなら作成者の設定とタイムゾーンで判定する', async () => {
    findTickets.mockResolvedValue([
      ticket({ id: 'ticket-agent', assignee: agent('user-agent') }),
      ticket({ id: 'ticket-none', assignee: null, createdBy: { ...person('user-creator'), timezone: 'UTC' } }),
    ] as never)
    remindable('user-creator')
    // ticket-none は作成者が UTC なので、まだ 01:00(9:00 前)
    expect(await runDueRemind(NOW)).toBe(1)
    expect(payloads().map((p) => p.ticketId)).toEqual(['ticket-agent'])
  })

  it('宛先が人でなければ送らない', async () => {
    findTickets.mockResolvedValue([ticket({ assignee: null, createdBy: agent('user-agent') })] as never)
    expect(await runDueRemind(NOW)).toBe(0)
    expect(createReminder).not.toHaveBeenCalled()
  })

  it('同じ期限・同じ種類の記録があれば投入しない。期限が変わっていれば改めて送る', async () => {
    findTickets.mockResolvedValue([
      ticket({ id: 'ticket-sent', dueReminders: [{ kind: 'day_before', dueDate: day('2026-10-20') }] }),
      ticket({ id: 'ticket-moved', dueReminders: [{ kind: 'day_before', dueDate: day('2026-10-19') }] }),
    ] as never)
    expect(await runDueRemind(NOW)).toBe(1)
    expect(payloads().map((p) => p.ticketId)).toEqual(['ticket-moved'])
  })

  it('記録を作れなかった(別の周が先に作った)ときは投入しない', async () => {
    findTickets.mockResolvedValue([ticket()] as never)
    createReminder.mockResolvedValue({ count: 0 })
    expect(await runDueRemind(NOW)).toBe(0)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('宛先が今はチケットを閲覧できなければ記録を作らない(権限が戻れば送れる)', async () => {
    findTickets.mockResolvedValue([ticket()] as never)
    ownerIds.mockResolvedValue([])
    expect(await runDueRemind(NOW)).toBe(0)
    expect(createReminder).not.toHaveBeenCalled()
  })

  it('流量制限で捨てられたら記録ごと取り消し、その周を打ち切る', async () => {
    findTickets.mockResolvedValue([ticket({ id: 'ticket-1' }), ticket({ id: 'ticket-2' })] as never)
    enqueue.mockResolvedValue(false)
    await expect(runDueRemind(NOW)).resolves.toBe(0)
    // $transaction のコールバックが投げる = 記録の作成もロールバックされる
    expect(createReminder).toHaveBeenCalledTimes(1)
  })

  it('1件が失敗しても残りは投入する(引いた後にチケットが消えたなど)', async () => {
    findTickets.mockResolvedValue([ticket({ id: 'ticket-1' }), ticket({ id: 'ticket-2' })] as never)
    createReminder.mockRejectedValueOnce(new Error('P2003'))
    expect(await runDueRemind(NOW)).toBe(1)
    expect(payloads().map((p) => p.ticketId)).toEqual(['ticket-2'])
  })

  it('1周で投入するのは上限まで', async () => {
    findTickets.mockResolvedValue(
      Array.from({ length: DUE_REMIND_BATCH + 5 }, (_, i) => ticket({ id: `ticket-${i}` })) as never,
    )
    expect(await runDueRemind(NOW)).toBe(DUE_REMIND_BATCH)
  })
})
