/**
 * 配信ワーカー 1 tick の単体テスト
 *
 * キューの出し入れ・宛先の解決・各チャネルの送信はすべて差し替え、流れの分岐
 * (失敗の分類、チャネルの打ち切り、メールのまとめ、スロットル)だけを固定する。
 */

import { NOTIFY_CHANNEL_RATE_LIMIT, NOTIFY_DELIVER_BATCH, NOTIFY_FANOUT_BATCH } from '@/lib/notify/notify'
import { buildNotifyContent } from '@/lib/notify/notify-content'
import { runNotifyDispatch } from '@/lib/notify/notify-dispatch'
import { deliverEmail, findMailRecipient } from '@/lib/notify/notify-email'
import { buildDeliveries, createDeliveries } from '@/lib/notify/notify-fanout'
import { parseNotifyPayload } from '@/lib/notify/notify-payload'
import {
  claimDeliveries,
  claimEmailDeliveries,
  claimOutbox,
  failOutbox,
  purge,
  reclaimStale,
  releaseDeliveries,
  settleDelivery,
  settleOutbox,
  type ClaimedDelivery,
  type ClaimedOutbox,
} from '@/lib/notify/notify-queue'
import { resolveNotifyTargets } from '@/lib/notify/notify-recipient'
import { deliverSlack } from '@/lib/notify/notify-slack'
import { deliverWebPush } from '@/lib/notify/notify-webpush'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit, remainingRateLimit } from '@/lib/rate-limit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({ user: ['findUnique'], notifyOutbox: ['update'] }),
)
vi.mock('@/lib/notify/notify-queue', () => ({
  claimDeliveries: vi.fn(),
  claimEmailDeliveries: vi.fn(),
  claimOutbox: vi.fn(),
  failOutbox: vi.fn(),
  purge: vi.fn(),
  reclaimStale: vi.fn(),
  releaseDeliveries: vi.fn(),
  settleDelivery: vi.fn(),
  settleOutbox: vi.fn(),
}))
vi.mock('@/lib/notify/notify-payload', () => ({ parseNotifyPayload: vi.fn() }))
vi.mock('@/lib/notify/notify-recipient', () => ({ resolveNotifyTargets: vi.fn() }))
vi.mock('@/lib/notify/notify-fanout', () => ({ buildDeliveries: vi.fn(), createDeliveries: vi.fn() }))
vi.mock('@/lib/notify/notify-content', () => ({ buildNotifyContent: vi.fn() }))
vi.mock('@/lib/notify/notify-email', () => ({ deliverEmail: vi.fn(), findMailRecipient: vi.fn() }))
vi.mock('@/lib/notify/notify-slack', () => ({ deliverSlack: vi.fn() }))
vi.mock('@/lib/notify/notify-webpush', () => ({ deliverWebPush: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ consumeRateLimit: vi.fn(), remainingRateLimit: vi.fn() }))

const now = new Date('2026-09-08T10:00:00.000Z')

const outbox = (override: Partial<ClaimedOutbox> = {}): ClaimedOutbox =>
  ({
    id: 'outbox-1',
    event: 'mention',
    actorId: 'actor-1',
    targetUserIds: ['u1'],
    attempts: 1,
    payload: { ticketId: 't1' },
    ...override,
  }) as ClaimedOutbox

const delivery = (override: Partial<ClaimedDelivery> = {}): ClaimedDelivery => ({
  id: 'd1',
  channel: 'slack',
  userId: 'u1',
  slackChannelId: null,
  attempts: 1,
  event: 'mention',
  payload: { ticketId: 't1' },
  ...override,
})

/** チャネルごとに取り出す配信行 */
const claimed: { slack: ClaimedDelivery[]; webpush: ClaimedDelivery[]; email: ClaimedDelivery[] } = {
  slack: [],
  webpush: [],
  email: [],
}

/** 結果を反映した配信行ID と結果の組 */
const settled = () => vi.mocked(settleDelivery).mock.calls.map(([row, outcome]) => [row.id, outcome])

beforeEach(() => {
  vi.clearAllMocks()
  claimed.slack = []
  claimed.webpush = []
  claimed.email = []
  vi.mocked(claimOutbox).mockResolvedValue([])
  vi.mocked(claimDeliveries).mockImplementation((async (channel: string) =>
    channel === 'slack' ? claimed.slack : claimed.webpush) as never)
  vi.mocked(claimEmailDeliveries).mockImplementation((async () => claimed.email) as never)
  vi.mocked(parseNotifyPayload).mockImplementation((_event, payload) => payload as never)
  vi.mocked(resolveNotifyTargets).mockResolvedValue({ userIds: ['u1'], slackChannelIds: [] })
  vi.mocked(buildDeliveries).mockResolvedValue([])
  vi.mocked(createDeliveries).mockResolvedValue(0)
  vi.mocked(buildNotifyContent).mockImplementation(
    (_event, _payload, locale, audience) => ({ subject: `${locale}:${audience}`, body: '', url: '' }) as never,
  )
  vi.mocked(remainingRateLimit).mockReturnValue(1000)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ locale: 'ja' } as never)
  vi.mocked(deliverSlack).mockResolvedValue('ok')
  vi.mocked(deliverWebPush).mockResolvedValue('ok')
  vi.mocked(deliverEmail).mockResolvedValue('ok')
  vi.mocked(findMailRecipient).mockImplementation(async (id) => ({ id, email: `${id}@example.com`, locale: 'en' }))
})

describe('runNotifyDispatch: 1 tick の流れ', () => {
  it('回収 → 展開 → 配信 → パージの順に進める', async () => {
    await runNotifyDispatch(now)

    expect(reclaimStale).toHaveBeenCalledWith(now)
    expect(claimOutbox).toHaveBeenCalledWith(NOTIFY_FANOUT_BATCH)
    expect(purge).toHaveBeenCalledWith(now)
    const order = (fn: unknown) => vi.mocked(fn as () => void).mock.invocationCallOrder[0]
    expect(order(reclaimStale)).toBeLessThan(order(claimOutbox))
    expect(order(claimOutbox)).toBeLessThan(order(claimDeliveries))
    expect(order(claimDeliveries)).toBeLessThan(order(purge))
  })

  it('1 つのチャネルが落ちても他のチャネルは送り、パージまで進む', async () => {
    vi.mocked(claimDeliveries).mockImplementation((async (channel: string) => {
      if (channel === 'slack') {
        throw new Error('db down')
      }
      return [delivery({ id: 'w1', channel: 'webpush' })]
    }) as never)
    claimed.email = [delivery({ id: 'e1', channel: 'email' })]

    await expect(runNotifyDispatch(now)).resolves.toBeUndefined()

    expect(deliverWebPush).toHaveBeenCalledTimes(1)
    expect(deliverEmail).toHaveBeenCalledTimes(1)
    expect(purge).toHaveBeenCalled()
  })
})

describe('runNotifyDispatch: アウトボックスの展開', () => {
  it('宛先を解決して配信行を作り、同じトランザクションで done にする', async () => {
    const deliveries = [{ outboxId: 'outbox-1', channel: 'slack' as const, userId: 'u1', scheduledAt: now }]
    vi.mocked(claimOutbox).mockResolvedValue([outbox()])
    vi.mocked(buildDeliveries).mockResolvedValue(deliveries)

    await runNotifyDispatch(now)

    expect(resolveNotifyTargets).toHaveBeenCalledWith('mention', { ticketId: 't1' }, { userIds: ['u1'] })
    expect(buildDeliveries).toHaveBeenCalledWith({
      outboxId: 'outbox-1',
      event: 'mention',
      actorId: 'actor-1',
      targets: { userIds: ['u1'], slackChannelIds: [] },
      now,
    })
    expect(createDeliveries).toHaveBeenCalledWith(deliveries, prisma)
    expect(prisma.notifyOutbox.update).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: { status: 'done', claimedAt: null },
    })
    expect(settleOutbox).not.toHaveBeenCalled()
    expect(failOutbox).not.toHaveBeenCalled()
  })

  it('宛先が 1 つも残らなくても done にする', async () => {
    vi.mocked(claimOutbox).mockResolvedValue([outbox()])

    await runNotifyDispatch(now)

    expect(prisma.notifyOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'done', claimedAt: null } }),
    )
  })

  it('ペイロードが壊れていれば再試行せず failed にし、次の行へ進む', async () => {
    vi.mocked(claimOutbox).mockResolvedValue([outbox({ id: 'broken' }), outbox({ id: 'outbox-2' })])
    vi.mocked(parseNotifyPayload).mockImplementationOnce(() => {
      throw new Error('invalid')
    })

    await runNotifyDispatch(now)

    expect(failOutbox).toHaveBeenCalledWith(expect.objectContaining({ id: 'broken' }), now)
    expect(settleOutbox).not.toHaveBeenCalled()
    expect(resolveNotifyTargets).toHaveBeenCalledTimes(1)
    expect(prisma.notifyOutbox.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'outbox-2' } }))
  })

  it('宛先の解決で落ちたら一時障害として再試行へ回す', async () => {
    vi.mocked(claimOutbox).mockResolvedValue([outbox()])
    vi.mocked(resolveNotifyTargets).mockRejectedValue(new Error('db down'))

    await runNotifyDispatch(now)

    expect(settleOutbox).toHaveBeenCalledWith(expect.objectContaining({ id: 'outbox-1' }), now)
    expect(failOutbox).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('配信行の作成で落ちたら done にせず再試行へ回す', async () => {
    vi.mocked(claimOutbox).mockResolvedValue([outbox()])
    vi.mocked(createDeliveries).mockRejectedValue(new Error('db down'))

    await runNotifyDispatch(now)

    expect(prisma.notifyOutbox.update).not.toHaveBeenCalled()
    expect(settleOutbox).toHaveBeenCalledWith(expect.objectContaining({ id: 'outbox-1' }), now)
  })
})

describe('runNotifyDispatch: Slack', () => {
  it('DM は宛先のロケール、チャンネルは既定ロケールで文面を組む', async () => {
    claimed.slack = [delivery({ id: 'dm' }), delivery({ id: 'ch', userId: null, slackChannelId: 'C0123ABCD' })]

    await runNotifyDispatch(now)

    expect(vi.mocked(deliverSlack).mock.calls.map(([arg]) => [arg.locale, arg.content.subject])).toEqual([
      ['ja', 'ja:dm'],
      [null, 'null:channel'],
    ])
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1)
    expect(settled()).toEqual([
      ['dm', 'ok'],
      ['ch', 'ok'],
    ])
  })

  it('送信で例外が出た行は failed にして、残りは送り続ける', async () => {
    claimed.slack = [delivery({ id: 'd1' }), delivery({ id: 'd2' })]
    vi.mocked(deliverSlack).mockRejectedValueOnce(new Error('boom'))

    await runNotifyDispatch(now)

    expect(settled()).toEqual([
      ['d1', 'failed'],
      ['d2', 'ok'],
    ])
  })

  it('トークン失効を掴んだら残りを送らず未処理へ戻し、送った分だけ枠を使う', async () => {
    claimed.slack = [delivery({ id: 'd1' }), delivery({ id: 'd2' }), delivery({ id: 'd3' }), delivery({ id: 'd4' })]
    vi.mocked(deliverSlack).mockResolvedValueOnce('ok').mockResolvedValueOnce('revoked')

    await runNotifyDispatch(now)

    expect(deliverSlack).toHaveBeenCalledTimes(2)
    expect(settled()).toEqual([
      ['d1', 'ok'],
      ['d2', 'revoked'],
    ])
    expect(releaseDeliveries).toHaveBeenCalledWith(['d3', 'd4'], 'revoked')
    expect(consumeRateLimit).toHaveBeenCalledWith('notify:slack', NOTIFY_CHANNEL_RATE_LIMIT.slack, 2)
  })

  it.each(['unlinked', 'rate_limited', 'retryable', 'failed'] as const)('%s では打ち切らない', async (outcome) => {
    claimed.slack = [delivery({ id: 'd1' }), delivery({ id: 'd2' })]
    vi.mocked(deliverSlack).mockResolvedValueOnce(outcome)

    await runNotifyDispatch(now)

    expect(deliverSlack).toHaveBeenCalledTimes(2)
    expect(releaseDeliveries).not.toHaveBeenCalled()
  })
})

describe('runNotifyDispatch: メール', () => {
  it('同じ相手の行は 1 通にまとめ、結果を全行へ反映する', async () => {
    claimed.email = [
      delivery({ id: 'e1', channel: 'email', userId: 'u1' }),
      delivery({ id: 'e2', channel: 'email', userId: 'u2' }),
      delivery({ id: 'e3', channel: 'email', userId: 'u1' }),
    ]
    vi.mocked(deliverEmail).mockImplementation(async ({ recipient }) => (recipient.id === 'u1' ? 'ok' : 'retryable'))

    await runNotifyDispatch(now)

    expect(deliverEmail).toHaveBeenCalledTimes(2)
    const first = vi.mocked(deliverEmail).mock.calls[0][0]
    expect(first.recipient.id).toBe('u1')
    expect(first.contents, '宛先のロケールで組む').toHaveLength(2)
    expect(first.contents[0].subject).toBe('en:dm')
    expect(settled()).toEqual([
      ['e1', 'ok'],
      ['e3', 'ok'],
      ['e2', 'retryable'],
    ])
    expect(consumeRateLimit, '枠は宛先ユーザー数ぶん').toHaveBeenCalledWith(
      'notify:email',
      NOTIFY_CHANNEL_RATE_LIMIT.email,
      2,
    )
  })

  it('宛先ユーザーの無い行は送らず unlinked にする', async () => {
    claimed.email = [delivery({ id: 'e1', channel: 'email', userId: null })]

    await runNotifyDispatch(now)

    expect(findMailRecipient).not.toHaveBeenCalled()
    expect(settled()).toEqual([['e1', 'unlinked']])
    expect(consumeRateLimit).not.toHaveBeenCalled()
  })

  it('宛先が引けなければ送らず unlinked にする', async () => {
    claimed.email = [delivery({ id: 'e1', channel: 'email' })]
    vi.mocked(findMailRecipient).mockResolvedValue(null)

    await runNotifyDispatch(now)

    expect(deliverEmail).not.toHaveBeenCalled()
    expect(settled()).toEqual([['e1', 'unlinked']])
  })

  it('送信で例外が出たらまとめた全行を failed にする', async () => {
    claimed.email = [delivery({ id: 'e1', channel: 'email' }), delivery({ id: 'e2', channel: 'email' })]
    vi.mocked(deliverEmail).mockRejectedValue(new Error('smtp down'))

    await runNotifyDispatch(now)

    expect(settled()).toEqual([
      ['e1', 'failed'],
      ['e2', 'failed'],
    ])
  })
})

describe('runNotifyDispatch: Web プッシュ', () => {
  it('同じチケットの通知を畳むため、チケットIDをタグにして送る', async () => {
    claimed.webpush = [delivery({ id: 'w1', channel: 'webpush', payload: { ticketId: 't9' } })]

    await runNotifyDispatch(now)

    expect(deliverWebPush).toHaveBeenCalledWith({
      userId: 'u1',
      content: expect.objectContaining({ subject: 'ja:dm' }),
      tag: 't9',
    })
    expect(settled()).toEqual([['w1', 'ok']])
  })

  it('宛先ユーザーの無い行は送らず unlinked にする', async () => {
    claimed.webpush = [delivery({ id: 'w1', channel: 'webpush', userId: null })]

    await runNotifyDispatch(now)

    expect(deliverWebPush).not.toHaveBeenCalled()
    expect(settled()).toEqual([['w1', 'unlinked']])
  })

  it('鍵の不正(revoked)を掴んだら残りを未処理へ戻す', async () => {
    claimed.webpush = [delivery({ id: 'w1', channel: 'webpush' }), delivery({ id: 'w2', channel: 'webpush' })]
    vi.mocked(deliverWebPush).mockResolvedValueOnce('revoked')

    await runNotifyDispatch(now)

    expect(deliverWebPush).toHaveBeenCalledTimes(1)
    expect(releaseDeliveries).toHaveBeenCalledWith(['w2'], 'revoked')
  })

  it('送信で例外が出た行は failed にする', async () => {
    claimed.webpush = [delivery({ id: 'w1', channel: 'webpush' })]
    vi.mocked(deliverWebPush).mockRejectedValue(new Error('boom'))

    await runNotifyDispatch(now)

    expect(settled()).toEqual([['w1', 'failed']])
  })
})

describe('runNotifyDispatch: スロットル', () => {
  it('取り出しの上限は残枠とバッチ上限の小さい方', async () => {
    vi.mocked(remainingRateLimit).mockImplementation((key) => (key === 'notify:slack' ? 3 : 1000))

    await runNotifyDispatch(now)

    expect(claimDeliveries).toHaveBeenCalledWith('slack', 3)
    expect(claimDeliveries).toHaveBeenCalledWith('webpush', NOTIFY_DELIVER_BATCH.webpush)
    expect(claimEmailDeliveries).toHaveBeenCalledWith(NOTIFY_DELIVER_BATCH.email)
  })

  it('枠が空のチャネルは取り出さずに次の tick へ持ち越す', async () => {
    vi.mocked(remainingRateLimit).mockImplementation((key) => (key === 'notify:slack' ? 0 : 1000))

    await runNotifyDispatch(now)

    expect(claimDeliveries).not.toHaveBeenCalledWith('slack', expect.anything())
    expect(claimDeliveries).toHaveBeenCalledWith('webpush', expect.anything())
  })

  it('送った件数ぶんだけ枠を使い、送らなければ使わない', async () => {
    claimed.slack = [delivery({ id: 'd1' }), delivery({ id: 'd2' })]

    await runNotifyDispatch(now)

    expect(consumeRateLimit).toHaveBeenCalledTimes(1)
    expect(consumeRateLimit).toHaveBeenCalledWith('notify:slack', NOTIFY_CHANNEL_RATE_LIMIT.slack, 2)
  })
})
