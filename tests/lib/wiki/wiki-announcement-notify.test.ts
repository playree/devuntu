/**
 * Wiki アナウンスの Slack 通知(wiki-announcement-notify.ts)
 *
 * 今すぐ・予約・変更・取り消しの可否と、ワーカーが期限の来た予約だけを送ること
 * (送信済み・取り消し済みは送らず、送れない状態なら理由を付けて見送ること)を、prisma を差し替えて確かめる。
 */

import { INVALID_OPERATION, TOO_MANY_REQUESTS } from '@/lib/error'
import { isSlackChannelPostEnabled } from '@/lib/notify/notify-board-setting'
import { enqueueNotify } from '@/lib/notify/notify-enqueue'
import type { NotifyPayload } from '@/lib/notify/notify-payload'
import { prisma } from '@/lib/prisma'
import { assertWikiSpaceAccess, getWikiSpaceAccess } from '@/lib/wiki/wiki-access'
import {
  cancelScheduledWikiAnnouncement,
  getWikiAnnouncementNotifies,
  notifyWikiAnnouncementNow,
  runWikiAnnouncementSchedule,
  scheduleWikiAnnouncement,
  skipScheduledWikiAnnouncementsOf,
  updateScheduledWikiAnnouncement,
} from '@/lib/wiki/wiki-announcement-notify'
import {
  MAX_WIKI_ANNOUNCE_SCHEDULED_PER_PAGE,
  WIKI_ANNOUNCE_BATCH,
  WIKI_ANNOUNCE_INVALID_SCHEDULE,
  WIKI_ANNOUNCE_NOT_SCHEDULED,
  WIKI_ANNOUNCE_SCAN_MAX,
  WIKI_ANNOUNCE_TOO_MANY_SCHEDULED,
  WIKI_ANNOUNCE_UNAVAILABLE,
} from '@/lib/wiki/wiki-announcement-notify-rule'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    wikiPage: ['findUnique'],
    wikiSpace: ['findUnique', 'findUniqueOrThrow'],
    wikiAnnouncementNotify: ['create', 'count', 'findUnique', 'findUniqueOrThrow', 'findMany', 'update', 'updateMany'],
  }),
)
vi.mock('@/lib/wiki/wiki-access', () => ({ assertWikiSpaceAccess: vi.fn(), getWikiSpaceAccess: vi.fn() }))
vi.mock('@/lib/notify/notify-board-setting', () => ({ isSlackChannelPostEnabled: vi.fn() }))
vi.mock('@/lib/notify/notify-enqueue', () => ({ enqueueNotify: vi.fn() }))
vi.mock('@/lib/auth/user-profile', () => ({
  getUserNameAndTimezone: vi.fn(async () => ({ name: '送った人', timezone: 'Asia/Tokyo' })),
}))
vi.mock('@/lib/rate-limit', () => ({ assertRateLimit: vi.fn() }))

const actor = { id: 'u1', role: 'user' }
const SPACE_ID = 's1'
const PAGE_ID = 'p1'
const NOW = new Date('2026-11-23T03:00:00.000Z')

const page = (override: Record<string, unknown> = {}) => ({
  id: PAGE_ID,
  spaceId: SPACE_ID,
  number: 12,
  title: '年末年始の休業',
  content: '## お知らせ\n\n12/29〜1/3 は休業です',
  space: { key: 'NEWS' },
  ...override,
})

const space = (override: Record<string, unknown> = {}) => ({
  type: 'announcement',
  archived: false,
  announceSlackChannelId: 'C0123ABCD',
  ...override,
})

const enqueuedPayload = () => vi.mocked(enqueueNotify).mock.calls[0][0].payload as NotifyPayload<'wiki_announcement'>

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(prisma.wikiPage.findUnique).mockResolvedValue(page() as never)
  vi.mocked(prisma.wikiSpace.findUnique).mockResolvedValue(space() as never)
  vi.mocked(prisma.wikiSpace.findUniqueOrThrow).mockResolvedValue(space() as never)
  vi.mocked(assertWikiSpaceAccess).mockResolvedValue({ type: 'announcement', role: 'editor', canWrite: true } as never)
  vi.mocked(isSlackChannelPostEnabled).mockResolvedValue(true)
  vi.mocked(enqueueNotify).mockResolvedValue(true)
  vi.mocked(prisma.wikiAnnouncementNotify.create).mockImplementation((async ({ data }: { data: unknown }) => ({
    id: 'n1',
    ...(data as object),
  })) as never)
  vi.mocked(prisma.wikiAnnouncementNotify.count).mockResolvedValue(0)
  vi.mocked(prisma.wikiAnnouncementNotify.updateMany).mockResolvedValue({ count: 1 })
  vi.mocked(prisma.wikiAnnouncementNotify.findUnique).mockResolvedValue({ pageId: PAGE_ID } as never)
})

describe('notifyWikiAnnouncementNow', () => {
  it('送信済みの行と通知キューへの投入を同じトランザクションで行い、件名・抜粋・ページの参照を載せる', async () => {
    await notifyWikiAnnouncementNow(actor, PAGE_ID, { kind: 'published', message: '' })

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.wikiAnnouncementNotify.create).mock.calls[0][0].data).toMatchObject({
      spaceId: SPACE_ID,
      pageId: PAGE_ID,
      kind: 'published',
      message: null,
      status: 'sent',
      sentAt: NOW,
      senderId: 'u1',
    })
    expect(vi.mocked(enqueueNotify).mock.calls[0][0]).toMatchObject({ event: 'wiki_announcement', actorId: 'u1' })
    // 同じトランザクションのクライアント(ここでは prisma 自体)で投入する
    expect(vi.mocked(enqueueNotify).mock.calls[0][1]).toBe(prisma)
    expect(enqueuedPayload()).toEqual({
      spaceId: SPACE_ID,
      spaceKey: 'NEWS',
      pageId: PAGE_ID,
      pageNumber: 12,
      pageTitle: '年末年始の休業',
      kind: 'published',
      fromName: '送った人',
      // 一言が空なら本文を announcementText() に通したもの
      excerpt: 'お知らせ\n\n12/29〜1/3 は休業です',
    })
  })

  it('一言は記法を落とさずにそのまま載せる', async () => {
    await notifyWikiAnnouncementNow(actor, PAGE_ID, {
      kind: 'updated',
      message: '対象: <v2.0> と **重要** な変更、3 * 4 件',
    })
    expect(enqueuedPayload().excerpt).toBe('対象: <v2.0> と **重要** な変更、3 * 4 件')
  })

  it('一言があれば本文の代わりに載せる', async () => {
    await notifyWikiAnnouncementNow(actor, PAGE_ID, { kind: 'updated', message: '  日付を修正しました  ' })
    expect(vi.mocked(prisma.wikiAnnouncementNotify.create).mock.calls[0][0].data).toMatchObject({
      message: '日付を修正しました',
    })
    expect(enqueuedPayload()).toMatchObject({ kind: 'updated', excerpt: '日付を修正しました' })
  })

  it('編集できなければ送らない', async () => {
    vi.mocked(assertWikiSpaceAccess).mockRejectedValue(Object.assign(new Error(), { errorType: INVALID_OPERATION }))
    await expect(notifyWikiAnnouncementNow(actor, PAGE_ID, { kind: 'published' })).rejects.toMatchObject({
      errorType: INVALID_OPERATION,
    })
    expect(enqueueNotify).not.toHaveBeenCalled()
  })

  it('アナウンス用スペースでなければ送らない', async () => {
    vi.mocked(assertWikiSpaceAccess).mockResolvedValue({ type: 'mixed', canWrite: true } as never)
    await expect(notifyWikiAnnouncementNow(actor, PAGE_ID, { kind: 'published' })).rejects.toMatchObject({
      errorType: INVALID_OPERATION,
    })
  })

  it.each([
    [
      'チャンネルが未設定',
      () => vi.mocked(prisma.wikiSpace.findUnique).mockResolvedValue(space({ announceSlackChannelId: null }) as never),
    ],
    ['Slack 連携が無効', () => vi.mocked(isSlackChannelPostEnabled).mockResolvedValue(false)],
  ])('%s なら WIKI_ANNOUNCE_UNAVAILABLE で拒否する', async (_label, arrange) => {
    arrange()
    await expect(notifyWikiAnnouncementNow(actor, PAGE_ID, { kind: 'published' })).rejects.toMatchObject({
      errorType: WIKI_ANNOUNCE_UNAVAILABLE,
    })
    expect(prisma.wikiAnnouncementNotify.create).not.toHaveBeenCalled()
    expect(enqueueNotify).not.toHaveBeenCalled()
  })

  it('流量制限で投入できなければエラーにする(行の作成もロールバックされる)', async () => {
    vi.mocked(enqueueNotify).mockResolvedValue(false)
    await expect(notifyWikiAnnouncementNow(actor, PAGE_ID, { kind: 'published' })).rejects.toMatchObject({
      errorType: TOO_MANY_REQUESTS,
    })
  })

  it('ページが無ければ送らない', async () => {
    vi.mocked(prisma.wikiPage.findUnique).mockResolvedValue(null)
    await expect(notifyWikiAnnouncementNow(actor, PAGE_ID, { kind: 'published' })).rejects.toMatchObject({
      errorType: INVALID_OPERATION,
    })
  })
})

describe('scheduleWikiAnnouncement', () => {
  const later = new Date(NOW.getTime() + 60 * 60 * 1000)

  it('予約中として保存し、この時点では通知キューへ入れない', async () => {
    await scheduleWikiAnnouncement(actor, PAGE_ID, { kind: 'published', scheduledAt: later })
    // 同じページへの予約を直列にするため、数える前にページ行をロックする
    const pageLock = (vi.mocked(prisma.$queryRaw).mock.calls as unknown as [TemplateStringsArray, ...unknown[]][]).find(
      ([strings]) => strings.join('').includes('"wiki_page"'),
    )
    expect(pageLock?.[0].join('')).toContain('FOR NO KEY UPDATE')
    expect(vi.mocked(prisma.wikiAnnouncementNotify.create).mock.calls[0][0].data).toMatchObject({
      status: 'scheduled',
      scheduledAt: later,
      senderId: 'u1',
    })
    expect(enqueueNotify).not.toHaveBeenCalled()
  })

  it.each([
    ['15分刻みでない', new Date(NOW.getTime() + 60 * 60 * 1000 + 7 * 60 * 1000)],
    ['過去', new Date(NOW.getTime() - 15 * 60 * 1000)],
    ['現在', NOW],
    ['1年より先', new Date(NOW.getTime() + 366 * 24 * 60 * 60 * 1000)],
  ])('%s の日時は WIKI_ANNOUNCE_INVALID_SCHEDULE', async (_label, scheduledAt) => {
    await expect(scheduleWikiAnnouncement(actor, PAGE_ID, { kind: 'published', scheduledAt })).rejects.toMatchObject({
      errorType: WIKI_ANNOUNCE_INVALID_SCHEDULE,
    })
    expect(prisma.wikiAnnouncementNotify.create).not.toHaveBeenCalled()
  })

  it('1ページの予約中が上限に達していれば拒否する', async () => {
    vi.mocked(prisma.wikiAnnouncementNotify.count).mockResolvedValue(MAX_WIKI_ANNOUNCE_SCHEDULED_PER_PAGE)
    await expect(
      scheduleWikiAnnouncement(actor, PAGE_ID, { kind: 'published', scheduledAt: later }),
    ).rejects.toMatchObject({ errorType: WIKI_ANNOUNCE_TOO_MANY_SCHEDULED })
  })

  it('チャンネルが未設定なら予約もできない', async () => {
    vi.mocked(prisma.wikiSpace.findUnique).mockResolvedValue(space({ announceSlackChannelId: null }) as never)
    await expect(
      scheduleWikiAnnouncement(actor, PAGE_ID, { kind: 'published', scheduledAt: later }),
    ).rejects.toMatchObject({ errorType: WIKI_ANNOUNCE_UNAVAILABLE })
  })
})

describe('updateScheduledWikiAnnouncement / cancelScheduledWikiAnnouncement', () => {
  const later = new Date(NOW.getTime() + 2 * 60 * 60 * 1000)

  it('予約中の行だけを変え、変えた人を送信者にする', async () => {
    await updateScheduledWikiAnnouncement({ id: 'u2' }, 'n1', { kind: 'updated', message: '再送', scheduledAt: later })
    expect(prisma.wikiAnnouncementNotify.updateMany).toHaveBeenCalledWith({
      where: { id: 'n1', status: 'scheduled' },
      data: { kind: 'updated', message: '再送', scheduledAt: later, senderId: 'u2' },
    })
  })

  it('送信済み・取り消し済み(予約中でない)なら WIKI_ANNOUNCE_NOT_SCHEDULED', async () => {
    vi.mocked(prisma.wikiAnnouncementNotify.updateMany).mockResolvedValue({ count: 0 })
    await expect(
      updateScheduledWikiAnnouncement(actor, 'n1', { kind: 'published', scheduledAt: later }),
    ).rejects.toMatchObject({ errorType: WIKI_ANNOUNCE_NOT_SCHEDULED })
    await expect(cancelScheduledWikiAnnouncement(actor, 'n1')).rejects.toMatchObject({
      errorType: WIKI_ANNOUNCE_NOT_SCHEDULED,
    })
  })

  it('取り消しは予約中の行を canceled にする。チャンネルが未設定でも取り消せる', async () => {
    vi.mocked(prisma.wikiSpace.findUnique).mockResolvedValue(space({ announceSlackChannelId: null }) as never)
    await cancelScheduledWikiAnnouncement(actor, 'n1')
    expect(prisma.wikiAnnouncementNotify.updateMany).toHaveBeenCalledWith({
      where: { id: 'n1', status: 'scheduled' },
      data: { status: 'canceled' },
    })
  })

  it('通知が無ければ INVALID_OPERATION', async () => {
    vi.mocked(prisma.wikiAnnouncementNotify.findUnique).mockResolvedValue(null)
    await expect(cancelScheduledWikiAnnouncement(actor, 'n1')).rejects.toMatchObject({ errorType: INVALID_OPERATION })
  })
})

describe('getWikiAnnouncementNotifies', () => {
  beforeEach(() => {
    vi.mocked(prisma.wikiAnnouncementNotify.findMany).mockResolvedValue([
      { id: 'n1', status: 'sent', sender: { name: '送った人' } },
      { id: 'n2', status: 'scheduled', sender: null },
    ] as never)
  })

  it('editor 以上には履歴と、送れる状態かを返す', async () => {
    const result = await getWikiAnnouncementNotifies(actor, PAGE_ID)
    expect(result.items.map(({ id, senderName }) => [id, senderName])).toEqual([
      ['n1', '送った人'],
      ['n2', ''],
    ])
    expect(result.available).toBe(true)
    expect(result.canWrite).toBe(true)
  })

  it('閲覧者(viewer)には返さない', async () => {
    vi.mocked(assertWikiSpaceAccess).mockResolvedValue({ type: 'announcement', role: 'viewer' } as never)
    await expect(getWikiAnnouncementNotifies(actor, PAGE_ID)).rejects.toMatchObject({ errorType: INVALID_OPERATION })
  })
})

describe('skipScheduledWikiAnnouncementsOf', () => {
  it('消すページの予約中の行だけを、ページ削除を理由に見送りにする', async () => {
    await skipScheduledWikiAnnouncementsOf(prisma, ['p1', 'p2'])
    expect(prisma.wikiAnnouncementNotify.updateMany).toHaveBeenCalledWith({
      where: { pageId: { in: ['p1', 'p2'] }, status: 'scheduled' },
      data: { status: 'skipped', skipReason: 'page_deleted' },
    })
  })
})

describe('runWikiAnnouncementSchedule', () => {
  const sender = { id: 'u1', role: 'user', name: '送った人', banned: false }
  const scheduledRow = (override: Record<string, unknown> = {}) => ({
    spaceId: SPACE_ID,
    pageId: PAGE_ID,
    kind: 'updated',
    message: null,
    sender,
    ...override,
  })
  const AT = new Date(NOW.getTime() - 60 * 1000)
  const due = (id: string, senderId = 'u1') => ({ id, spaceId: SPACE_ID, senderId, scheduledAt: AT })
  /** 候補の読み出し。1 回目に `rows`、続きの読み出しでは空を返す */
  const dueRows = (...pages: ReturnType<typeof due>[][]) => {
    const findMany = vi.mocked(prisma.wikiAnnouncementNotify.findMany).mockReset().mockResolvedValue([])
    for (const rows of pages) {
      findMany.mockResolvedValueOnce(rows as never)
    }
  }

  beforeEach(() => {
    dueRows([due('n1', 'u1')])
    // 予約中で期限の来た行のロックが取れた
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: 'n1' }] as never)
    vi.mocked(prisma.wikiAnnouncementNotify.findUniqueOrThrow).mockResolvedValue(scheduledRow() as never)
    vi.mocked(getWikiSpaceAccess).mockResolvedValue({ canWrite: true } as never)
    vi.mocked(prisma.wikiPage.findUnique).mockResolvedValue(page({ title: '送る時点のタイトル' }) as never)
  })

  const updated = () => vi.mocked(prisma.wikiAnnouncementNotify.update).mock.calls.map(([arg]) => arg.data)

  it('送る時点のページは削除済みを除いて引く(削除済みなら page_deleted で見送る)', async () => {
    await runWikiAnnouncementSchedule(NOW, { resumeFrom: null })
    expect(vi.mocked(prisma.wikiPage.findUnique).mock.calls[0][0]?.where).toEqual({ id: PAGE_ID, deletedAt: null })
  })

  it('期限の来た予約中の行だけを候補にする', async () => {
    await runWikiAnnouncementSchedule(NOW, { resumeFrom: null })
    expect(vi.mocked(prisma.wikiAnnouncementNotify.findMany).mock.calls[0][0]).toMatchObject({
      where: { status: 'scheduled', scheduledAt: { lte: NOW } },
    })
    const calls = vi.mocked(prisma.$queryRaw).mock.calls as unknown as [TemplateStringsArray, ...unknown[]][]
    const sqlOf = ([strings]: [TemplateStringsArray, ...unknown[]]) => strings.join('?')
    // 利用者の操作と同じく、先にスペース行を共有ロックする(予約行を先に取るとページの削除とデッドロックする)
    expect(sqlOf(calls[0])).toContain('"wiki_space"')
    expect(sqlOf(calls[0])).toContain('FOR SHARE')
    expect(calls[0].slice(1)).toEqual([SPACE_ID])
    // ロックの取り直しでも、予約中で期限が来ていることを条件にする
    const [, ...values] = calls[1]
    const sql = sqlOf(calls[1])
    expect(sql).toContain(`"status" = 'scheduled'`)
    expect(sql).toContain('"scheduledAt" <=')
    expect(sql).toContain('FOR UPDATE SKIP LOCKED')
    expect(values).toEqual(['n1', NOW])
  })

  it('送信時点の最新の内容で投入し、送信済みにする', async () => {
    expect(await runWikiAnnouncementSchedule(NOW, { resumeFrom: null })).toBe(1)
    expect(enqueuedPayload()).toMatchObject({
      pageTitle: '送る時点のタイトル',
      kind: 'updated',
      fromName: '送った人',
      excerpt: 'お知らせ\n\n12/29〜1/3 は休業です',
    })
    expect(vi.mocked(enqueueNotify).mock.calls[0][0].actorId).toBe('u1')
    expect(updated()).toEqual([{ status: 'sent', sentAt: NOW }])
  })

  it('予約時刻の前の行・送信済み・取り消し済みの行(ロックの条件に合わない)は送らない', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
    expect(await runWikiAnnouncementSchedule(NOW, { resumeFrom: null })).toBe(0)
    expect(enqueueNotify).not.toHaveBeenCalled()
    expect(prisma.wikiAnnouncementNotify.update).not.toHaveBeenCalled()
  })

  it('候補が無ければ何もしない', async () => {
    dueRows()
    expect(await runWikiAnnouncementSchedule(NOW, { resumeFrom: null })).toBe(0)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it.each([
    ['page_deleted', () => vi.mocked(prisma.wikiPage.findUnique).mockResolvedValue(null)],
    [
      'archived',
      () => vi.mocked(prisma.wikiSpace.findUniqueOrThrow).mockResolvedValue(space({ archived: true }) as never),
    ],
    [
      'channel_unset',
      () =>
        vi
          .mocked(prisma.wikiSpace.findUniqueOrThrow)
          .mockResolvedValue(space({ announceSlackChannelId: null }) as never),
    ],
    ['slack_disabled', () => vi.mocked(isSlackChannelPostEnabled).mockResolvedValue(false)],
    ['no_permission', () => vi.mocked(getWikiSpaceAccess).mockResolvedValue({ canWrite: false } as never)],
    [
      'no_permission',
      () =>
        vi
          .mocked(prisma.wikiAnnouncementNotify.findUniqueOrThrow)
          .mockResolvedValue(scheduledRow({ sender: null }) as never),
    ],
    [
      'no_permission',
      () =>
        vi
          .mocked(prisma.wikiAnnouncementNotify.findUniqueOrThrow)
          .mockResolvedValue(scheduledRow({ sender: { ...sender, banned: true } }) as never),
    ],
  ])('送れない状態(%s)なら理由を付けて見送る', async (skipReason, arrange) => {
    arrange()
    expect(await runWikiAnnouncementSchedule(NOW, { resumeFrom: null })).toBe(0)
    expect(enqueueNotify).not.toHaveBeenCalled()
    expect(updated()).toEqual([{ status: 'skipped', skipReason }])
  })

  it('流量制限で投入できなければ予約のまま残し、その送信者の分だけをこの周で飛ばす', async () => {
    dueRows([due('n1', 'u1'), due('n2', 'u1'), due('n3', 'u2')])
    vi.mocked(prisma.wikiAnnouncementNotify.findUniqueOrThrow)
      .mockResolvedValueOnce(scheduledRow() as never)
      .mockResolvedValueOnce(scheduledRow({ sender: { ...sender, id: 'u2', name: '別の人' } }) as never)
    vi.mocked(enqueueNotify).mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    expect(await runWikiAnnouncementSchedule(NOW, { resumeFrom: null })).toBe(1)
    // n2(同じ送信者)は試さず、n3(別の送信者)は送る
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(updated()).toEqual([{ status: 'sent', sentAt: NOW }])
  })

  it('先頭が送れない予約で埋まっていても、続きを読んで後ろの予約を送る', async () => {
    const blocked = Array.from({ length: WIKI_ANNOUNCE_BATCH }, (_, i) => due(`a${i}`, 'u1'))
    dueRows(blocked, [due('b1', 'u2')])
    vi.mocked(prisma.wikiAnnouncementNotify.findUniqueOrThrow)
      .mockResolvedValueOnce(scheduledRow() as never)
      .mockResolvedValueOnce(scheduledRow({ sender: { ...sender, id: 'u2', name: '別の人' } }) as never)
    vi.mocked(enqueueNotify).mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    expect(await runWikiAnnouncementSchedule(NOW, { resumeFrom: null })).toBe(1)
    // 流量制限に当たった u1 の残りは試さない
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    // 続きは最後に読んだ行の後から、u1 を除いて読む
    const second = vi.mocked(prisma.wikiAnnouncementNotify.findMany).mock.calls[1][0]
    expect(second?.where?.AND).toEqual([
      { OR: [{ scheduledAt: { gt: AT } }, { scheduledAt: AT, id: { gt: `a${WIKI_ANNOUNCE_BATCH - 1}` } }] },
      { OR: [{ senderId: null }, { senderId: { notIn: ['u1'] } }] },
    ])
  })

  it('読む上限まで失敗し続けたら、次の周はその続きから読む(末尾まで読んだら先頭へ戻る)', async () => {
    const failing = Array.from({ length: WIKI_ANNOUNCE_SCAN_MAX }, (_, i) => due(`a${String(i).padStart(3, '0')}`))
    const pages = Array.from({ length: WIKI_ANNOUNCE_SCAN_MAX / WIKI_ANNOUNCE_BATCH }, (_, i) =>
      failing.slice(i * WIKI_ANNOUNCE_BATCH, (i + 1) * WIKI_ANNOUNCE_BATCH),
    )
    dueRows(...pages)
    vi.mocked(prisma.wikiAnnouncementNotify.findUniqueOrThrow).mockRejectedValue(new Error('unexpected'))
    const state = { resumeFrom: null }

    expect(await runWikiAnnouncementSchedule(NOW, state)).toBe(0)
    const last = failing.at(-1)!
    expect(state.resumeFrom).toEqual({ scheduledAt: AT, id: last.id })

    // 次の周は続きから読み、後ろの予約を送る
    dueRows([due('b1', 'u2')])
    vi.mocked(prisma.wikiAnnouncementNotify.findUniqueOrThrow)
      .mockReset()
      .mockResolvedValue(scheduledRow() as never)
    expect(await runWikiAnnouncementSchedule(NOW, state)).toBe(1)
    expect(vi.mocked(prisma.wikiAnnouncementNotify.findMany).mock.calls[0][0]?.where?.AND).toEqual([
      { OR: [{ scheduledAt: { gt: AT } }, { scheduledAt: AT, id: { gt: last.id } }] },
    ])
    // 末尾まで読んだので、その次の周は先頭から
    expect(state.resumeFrom).toBeNull()
  })

  it('1件が失敗しても残りは送る', async () => {
    dueRows([due('n1', 'u1'), due('n2', 'u1')])
    vi.mocked(prisma.wikiAnnouncementNotify.findUniqueOrThrow)
      .mockRejectedValueOnce(new Error('P2025'))
      .mockResolvedValue(scheduledRow() as never)
    expect(await runWikiAnnouncementSchedule(NOW, { resumeFrom: null })).toBe(1)
  })
})
