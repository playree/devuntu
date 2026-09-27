/**
 * アウトボックスの展開の単体テスト
 *
 * 送らない相手(通知OFF / 未連携 / 許可グループ外 / 未構成 / 操作した本人)がここで消えるので、
 * 「誰にどのチャネルの行ができるか」を固定する。通知設定・連携可否・構成の判定は差し替える。
 */

import type { Prisma } from '@/generated/prisma/client'
import { isMailConfigured } from '@/lib/mail'
import { MAX_NOTIFY_RECIPIENTS, NOTIFY_EMAIL_WINDOW_MS } from '@/lib/notify/notify'
import { buildDeliveries, createDeliveries } from '@/lib/notify/notify-fanout'
import { filterNotifiable } from '@/lib/notify/notify-setting'
import { prisma } from '@/lib/prisma'
import { filterSlackAllowedUserIds, getSlackSettings, hasSlackCredentials } from '@/lib/slack/slack-account'
import { isWebPushConfigured } from '@/lib/webpush/webpush-server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    user: ['findMany'],
    account: ['findMany'],
    webPushSubscription: ['findMany'],
    notifyDelivery: ['createMany'],
  }),
)
vi.mock('@/lib/notify/notify-setting', () => ({ filterNotifiable: vi.fn() }))
vi.mock('@/lib/slack/slack-account', () => ({
  filterSlackAllowedUserIds: vi.fn(),
  getSlackSettings: vi.fn(),
  hasSlackCredentials: vi.fn(),
}))
vi.mock('@/lib/mail', () => ({ isMailConfigured: vi.fn() }))
vi.mock('@/lib/webpush/webpush-server', () => ({ isWebPushConfigured: vi.fn() }))

const notifiable = vi.mocked(filterNotifiable)
const slackAllowed = vi.mocked(filterSlackAllowedUserIds)
const slackSettings = vi.mocked(getSlackSettings)
const slackCredentials = vi.mocked(hasSlackCredentials)
const mailConfigured = vi.mocked(isMailConfigured)
const webPushConfigured = vi.mocked(isWebPushConfigured)
const findUsers = vi.mocked(prisma.user.findMany)
const findAccounts = vi.mocked(prisma.account.findMany)
const findSubscriptions = vi.mocked(prisma.webPushSubscription.findMany)

const now = new Date('2026-09-08T10:00:30.000Z')
const emailAt = new Date(
  Math.floor(now.getTime() / NOTIFY_EMAIL_WINDOW_MS) * NOTIFY_EMAIL_WINDOW_MS + NOTIFY_EMAIL_WINDOW_MS,
)

/** where.xxx.in に渡された ID を取り出す */
const inIds = (arg: unknown, field: string): string[] =>
  ((arg as { where: Record<string, { in: string[] }> }).where[field]?.in ?? []) as string[]

/** チャネルごとに通知 ON のユーザー。既定は全員 ON */
let muted: Record<string, string[]> = {}

const build = (override: Partial<Parameters<typeof buildDeliveries>[0]> = {}) =>
  buildDeliveries({
    outboxId: 'outbox-1',
    event: 'mention',
    actorId: null,
    targets: { userIds: ['u1'], slackChannelIds: [] },
    now,
    ...override,
  })

/** チャネル → 宛先(ユーザーIDかチャンネルID)の一覧 */
const byChannel = (deliveries: Awaited<ReturnType<typeof buildDeliveries>>) =>
  deliveries.map(({ channel, userId, slackChannelId }) => `${channel}:${userId ?? slackChannelId}`)

beforeEach(() => {
  vi.clearAllMocks()
  muted = {}
  notifiable.mockImplementation(async (userIds, _event, channel) =>
    userIds.filter((id) => !(muted[channel] ?? []).includes(id)),
  )
  slackAllowed.mockImplementation(async (userIds) => userIds)
  slackSettings.mockResolvedValue({ enabled: true } as never)
  slackCredentials.mockReturnValue(true)
  mailConfigured.mockReturnValue(true)
  webPushConfigured.mockReturnValue(true)
  findUsers.mockImplementation((async (arg: unknown) => inIds(arg, 'id').map((id) => ({ id }))) as never)
  findAccounts.mockImplementation((async (arg: unknown) => inIds(arg, 'userId').map((userId) => ({ userId }))) as never)
  findSubscriptions.mockImplementation((async (arg: unknown) =>
    inIds(arg, 'userId').map((userId) => ({ userId }))) as never)
})

describe('buildDeliveries: DM の宛先', () => {
  it('全チャネルが使えれば、メール・Slack・Web プッシュの行を作る', async () => {
    const deliveries = await build()

    expect(deliveries).toEqual([
      { outboxId: 'outbox-1', channel: 'email', userId: 'u1', scheduledAt: emailAt },
      { outboxId: 'outbox-1', channel: 'slack', userId: 'u1', scheduledAt: now },
      { outboxId: 'outbox-1', channel: 'webpush', userId: 'u1', scheduledAt: now },
    ])
  })

  it('メールだけは次のウィンドウ境界へ丸める', async () => {
    const deliveries = await build()
    const emailTime = deliveries.find(({ channel }) => channel === 'email')?.scheduledAt.getTime() ?? Number.NaN

    expect(emailTime).toBeGreaterThan(now.getTime())
    expect(emailTime % NOTIFY_EMAIL_WINDOW_MS).toBe(0)
  })

  it('操作した本人には送らない', async () => {
    const deliveries = await build({ actorId: 'u1', targets: { userIds: ['u1', 'u2'], slackChannelIds: [] } })

    expect(byChannel(deliveries)).toEqual(['email:u2', 'slack:u2', 'webpush:u2'])
    expect(notifiable.mock.calls.every(([userIds]) => !userIds.includes('u1'))).toBe(true)
  })

  it('宛先が居なければ何も引かずに空', async () => {
    expect(await build({ targets: { userIds: [], slackChannelIds: [] } })).toEqual([])
    expect(notifiable).not.toHaveBeenCalled()
  })

  it('通知 OFF のチャネルだけ行を作らない', async () => {
    muted = { email: ['u1'], webpush: ['u1'] }

    expect(byChannel(await build())).toEqual(['slack:u1'])
  })

  it('メールが未構成ならメールの行を作らず、設定も引かない', async () => {
    mailConfigured.mockReturnValue(false)

    expect(byChannel(await build())).toEqual(['slack:u1', 'webpush:u1'])
    expect(notifiable.mock.calls.some(([, , channel]) => channel === 'email')).toBe(false)
  })

  it('Web プッシュが未構成なら Web プッシュの行を作らない', async () => {
    webPushConfigured.mockReturnValue(false)

    expect(byChannel(await build())).toEqual(['email:u1', 'slack:u1'])
  })

  it('端末を登録していないユーザーには Web プッシュを作らない', async () => {
    findSubscriptions.mockResolvedValue([] as never)

    expect(byChannel(await build())).toEqual(['email:u1', 'slack:u1'])
  })

  it('Slack の許可グループ外なら Slack DM を作らない', async () => {
    slackAllowed.mockResolvedValue([])

    expect(byChannel(await build())).toEqual(['email:u1', 'webpush:u1'])
    expect(findAccounts).not.toHaveBeenCalled()
  })

  it('Slack 未連携なら Slack DM を作らない', async () => {
    findAccounts.mockResolvedValue([] as never)

    expect(byChannel(await build())).toEqual(['email:u1', 'webpush:u1'])
  })

  it('Slack アカウントを複数連携していても DM は 1 行', async () => {
    findAccounts.mockResolvedValue([{ userId: 'u1' }, { userId: 'u1' }] as never)

    expect(byChannel(await build()).filter((key) => key.startsWith('slack:'))).toEqual(['slack:u1'])
  })

  it('メールの宛先は DB から引き直した順(id 順)に並ぶ', async () => {
    findUsers.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }] as never)
    const deliveries = await build({ targets: { userIds: ['u2', 'u1'], slackChannelIds: [] } })

    expect(findUsers.mock.calls[0][0]).toMatchObject({ orderBy: { id: 'asc' } })
    expect(deliveries.filter(({ channel }) => channel === 'email').map(({ userId }) => userId)).toEqual(['u1', 'u2'])
  })

  it(`チャネルごとに ${MAX_NOTIFY_RECIPIENTS} 人で切り詰める`, async () => {
    const userIds = Array.from(
      { length: MAX_NOTIFY_RECIPIENTS + 5 },
      (_, index) => `u${String(index).padStart(2, '0')}`,
    )
    const deliveries = await build({ targets: { userIds, slackChannelIds: [] } })

    for (const channel of ['email', 'slack', 'webpush']) {
      const ids = deliveries.filter((delivery) => delivery.channel === channel).map(({ userId }) => userId)
      expect(ids, channel).toEqual(userIds.slice(0, MAX_NOTIFY_RECIPIENTS))
    }
  })
})

describe('buildDeliveries: チャンネル通知', () => {
  const targets = { userIds: [], slackChannelIds: ['C0000000B', 'C0000000A'] }

  it('チャンネルID順に並べて行を作る(即時)', async () => {
    const deliveries = await build({ targets })

    expect(deliveries).toEqual([
      { outboxId: 'outbox-1', channel: 'slack', slackChannelId: 'C0000000A', scheduledAt: now },
      { outboxId: 'outbox-1', channel: 'slack', slackChannelId: 'C0000000B', scheduledAt: now },
    ])
  })

  it('渡された配列の並びは変えない', async () => {
    const slackChannelIds = ['C0000000B', 'C0000000A']
    await build({ targets: { userIds: [], slackChannelIds } })

    expect(slackChannelIds).toEqual(['C0000000B', 'C0000000A'])
  })

  it('管理者が Slack 連携を無効にしていれば作らない', async () => {
    slackSettings.mockResolvedValue({ enabled: false } as never)

    expect(await build({ targets })).toEqual([])
  })

  it('Slack の認証情報が揃っていなければ設定も引かずに作らない', async () => {
    slackCredentials.mockReturnValue(false)

    expect(await build({ targets })).toEqual([])
    expect(slackSettings).not.toHaveBeenCalled()
  })

  it('ユーザーの通知設定では止まらない', async () => {
    muted = { slack: ['u1'] }

    expect(byChannel(await build({ targets: { userIds: ['u1'], slackChannelIds: ['C0000000A'] } }))).toEqual([
      'email:u1',
      'webpush:u1',
      'slack:C0000000A',
    ])
  })

  it(`チャンネルも ${MAX_NOTIFY_RECIPIENTS} 件で切り詰める`, async () => {
    const slackChannelIds = Array.from(
      { length: MAX_NOTIFY_RECIPIENTS + 1 },
      (_, index) => `C${String(index).padStart(8, '0')}`,
    )

    expect(await build({ targets: { userIds: [], slackChannelIds } })).toHaveLength(MAX_NOTIFY_RECIPIENTS)
  })
})

describe('createDeliveries', () => {
  it('行が無ければ書き込まない', async () => {
    expect(await createDeliveries([])).toBe(0)
    expect(prisma.notifyDelivery.createMany).not.toHaveBeenCalled()
  })

  it('渡されたトランザクションで一括作成し、件数を返す', async () => {
    const createMany = vi.fn(async () => ({ count: 1 }))
    const tx = { notifyDelivery: { createMany } } as unknown as Prisma.TransactionClient
    const deliveries = [{ outboxId: 'outbox-1', channel: 'slack' as const, userId: 'u1', scheduledAt: now }]

    expect(await createDeliveries(deliveries, tx)).toBe(1)
    expect(createMany).toHaveBeenCalledWith({ data: deliveries })
    expect(prisma.notifyDelivery.createMany).not.toHaveBeenCalled()
  })
})
