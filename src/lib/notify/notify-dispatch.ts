/**
 * 通知の配信ワーカー本体(サーバー専用)
 *
 * 1 tick で「回収 → 展開 → 配信 → パージ」を行う。`runNotifyDispatch()` は起動方法に
 * 依存しないので、アプリ内スケジューラ(`notify-worker.ts`)からでも、将来 HTTP
 * エンドポイントを足す場合でも同じものを呼べる。
 *
 * 取り出しは `FOR UPDATE SKIP LOCKED` で行う。これにより同じ行を2つのワーカーが同時に
 * 処理することがなく、リーダー選出の仕組みが要らない(Prisma のコネクションプールでは
 * セッションレベルの advisory lock を保持できないため、そもそも採れない)。
 */

import type { NotifyEvent } from '@/generated/prisma/enums'
import { nowDate } from '../day'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { consumeRateLimit } from '../rate-limit'
import {
  NOTIFY_CHANNEL_RATE_LIMIT,
  NOTIFY_CHANNELS,
  NOTIFY_CLAIM_TIMEOUT_MS,
  NOTIFY_DELIVER_BATCH,
  NOTIFY_FAILED_RETENTION_MS,
  NOTIFY_FANOUT_BATCH,
  type NotifyChannel,
} from './notify'
import { buildNotifyContent } from './notify-content'
import { deliverEmail, findMailRecipient } from './notify-email'
import { buildDeliveries, createDeliveries } from './notify-fanout'
import { isDeliveryAborting, isDeliverySettled, type DeliveryOutcome } from './notify-outcome'
import { parseNotifyPayload } from './notify-payload'
import { resolveNotifyTargets } from './notify-recipient'
import { isRetryExhausted, retryScheduledAt, staleClaimBefore } from './notify-schedule'
import { deliverSlack } from './notify-slack'

type ClaimedOutbox = {
  id: string
  event: NotifyEvent
  actorId: string | null
  targetUserIds: string[]
  targetSlackChannelIds: string[]
  payload: unknown
}

type ClaimedDelivery = {
  id: string
  channel: NotifyChannel
  userId: string | null
  slackChannelId: string | null
  attempts: number
  event: NotifyEvent
  payload: unknown
}

/**
 * 処理中のまま放置された行を未処理へ戻す。
 *
 * コンテナの再起動やクラッシュで掴んだまま終わった行は、誰も面倒を見ないと残り続ける。
 * `attempts` は claim 時に加算済みなので、回収を繰り返しても無限には試行しない。
 */
const reclaimStale = async (now: Date): Promise<void> => {
  const before = staleClaimBefore(now, NOTIFY_CLAIM_TIMEOUT_MS)

  const [outbox, delivery] = await Promise.all([
    prisma.notifyOutbox.updateMany({
      where: { status: 'processing', claimedAt: { lt: before } },
      data: { status: 'pending', claimedAt: null },
    }),
    prisma.notifyDelivery.updateMany({
      where: { status: 'processing', claimedAt: { lt: before } },
      data: { status: 'pending', claimedAt: null },
    }),
  ])

  if (outbox.count > 0 || delivery.count > 0) {
    logger.warn({ outbox: outbox.count, delivery: delivery.count }, 'notify jobs reclaimed')
  }
}

/** 未処理のアウトボックスを発生順に掴む */
const claimOutbox = (limit: number) => prisma.$queryRaw<ClaimedOutbox[]>`
  UPDATE "notify_outbox"
  SET "status" = 'processing', "claimedAt" = NOW(), "attempts" = "attempts" + 1
  WHERE "id" IN (
    SELECT "id" FROM "notify_outbox"
    WHERE "status" = 'pending'
    ORDER BY "createdAt", "id"
    LIMIT ${limit}
    FOR UPDATE SKIP LOCKED
  )
  RETURNING "id", "event", "actorId", "targetUserIds", "targetSlackChannelIds", "payload"
`

/** 期限が来た配信をチャネル単位で掴む。アウトボックスの内容も一緒に引いて往復を減らす */
const claimDeliveries = (channel: NotifyChannel, limit: number) => prisma.$queryRaw<ClaimedDelivery[]>`
  WITH claimed AS (
    UPDATE "notify_delivery"
    SET "status" = 'processing', "claimedAt" = NOW(), "attempts" = "attempts" + 1
    WHERE "id" IN (
      SELECT "id" FROM "notify_delivery"
      WHERE "channel" = ${channel}::"NotifyChannel" AND "status" = 'pending' AND "scheduledAt" <= NOW()
      ORDER BY "scheduledAt", "id"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "channel", "userId", "slackChannelId", "attempts", "outboxId"
  )
  SELECT c."id", c."channel", c."userId", c."slackChannelId", c."attempts", o."event", o."payload"
  FROM claimed c JOIN "notify_outbox" o ON o."id" = c."outboxId"
  ORDER BY c."id"
`

/**
 * 掴んだアウトボックスを配信行へ展開する。
 *
 * 宛先が 1 つも残らなかった場合も `done` にする(送らないことは失敗ではない)。
 * ペイロードが壊れている行は文面を組み立てられないので `failed` にして残す。
 */
const fanoutOutbox = async (now: Date): Promise<void> => {
  const claimed = await claimOutbox(NOTIFY_FANOUT_BATCH)

  for (const outbox of claimed) {
    const { id, event, targetUserIds, targetSlackChannelIds } = outbox
    try {
      const payload = parseNotifyPayload(event, outbox.payload)
      const targets = await resolveNotifyTargets(event, payload, {
        userIds: targetUserIds,
        slackChannelIds: targetSlackChannelIds,
      })
      const deliveries = await buildDeliveries({ outboxId: id, event, targets, now })

      await prisma.$transaction(async (tx) => {
        await createDeliveries(deliveries, tx)
        await tx.notifyOutbox.update({ where: { id }, data: { status: 'done', claimedAt: null } })
      })
      logger.info({ outboxId: id, event, deliveries: deliveries.length }, 'notify fanned out')
    } catch (error) {
      logger.error({ error, outboxId: id, event }, 'notify fanout failed')
      await prisma.notifyOutbox.update({ where: { id }, data: { status: 'failed', claimedAt: null } })
    }
  }
}

/** 送信結果に応じて配信行を片付ける */
const settleDelivery = async (delivery: ClaimedDelivery, outcome: DeliveryOutcome, now: Date): Promise<void> => {
  const { id, attempts, channel } = delivery

  if (isDeliverySettled(outcome)) {
    // 送信済み(または宛先が消えた)行は残す意味が無い。送信の記録はログにある
    await prisma.notifyDelivery.delete({ where: { id } })
    return
  }

  // トークン失効はこの tick では直らないので、試行回数を戻して次に回す
  if (isDeliveryAborting(outcome)) {
    await prisma.notifyDelivery.update({
      where: { id },
      data: { status: 'pending', claimedAt: null, attempts: Math.max(0, attempts - 1), lastError: outcome },
    })
    return
  }

  if (isRetryExhausted(attempts)) {
    logger.error({ deliveryId: id, channel, attempts, outcome }, 'notify delivery gave up')
    await prisma.notifyDelivery.update({
      where: { id },
      data: { status: 'failed', claimedAt: null, lastError: outcome },
    })
    return
  }

  await prisma.notifyDelivery.update({
    where: { id },
    data: {
      status: 'pending',
      claimedAt: null,
      scheduledAt: retryScheduledAt(now, attempts),
      lastError: outcome,
    },
  })
}

/** 1 配信ぶんを送る。宛先のロケールで文面を組み立てる */
const send = async (delivery: ClaimedDelivery): Promise<DeliveryOutcome> => {
  const { channel, userId, slackChannelId, event } = delivery
  const payload = parseNotifyPayload(event, delivery.payload)

  if (channel === 'email') {
    if (!userId) {
      return 'unlinked'
    }
    const recipient = await findMailRecipient(userId)
    if (!recipient) {
      return 'unlinked'
    }
    return deliverEmail({ recipient, content: buildNotifyContent(event, payload, recipient.locale) })
  }

  /**
   * チャンネル宛は宛先がユーザーではないのでロケールを解決する相手がいない。
   * 文面は null を渡して既定ロケール(`DEFAULT_LOCALE`)に固定する。
   */
  const locale = userId ? await userLocale(userId) : null
  return deliverSlack({ userId, slackChannelId, content: buildNotifyContent(event, payload, locale), locale })
}

const userLocale = async (userId: string): Promise<string | null> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { locale: true } })
  return user?.locale ?? null
}

/**
 * 1 チャネルぶんを逐次で送る。
 *
 * 並行に送らないのは、ワークスペース単位のバーストを避けるため(既存の方針を踏襲)。
 * チャネル全体のスロットルを先に消費し、超過した tick は次へ持ち越す。
 */
const deliverChannel = async (channel: NotifyChannel, now: Date): Promise<void> => {
  if (!consumeRateLimit(`notify:${channel}`, NOTIFY_CHANNEL_RATE_LIMIT[channel])) {
    logger.warn({ channel }, 'notify channel throttled')
    return
  }

  const claimed = await claimDeliveries(channel, NOTIFY_DELIVER_BATCH[channel])
  if (claimed.length === 0) {
    return
  }

  for (const [index, delivery] of claimed.entries()) {
    let outcome: DeliveryOutcome
    try {
      outcome = await send(delivery)
    } catch (error) {
      logger.error({ error, deliveryId: delivery.id, channel }, 'notify delivery failed')
      outcome = 'failed'
    }
    await settleDelivery(delivery, outcome, now)

    if (isDeliveryAborting(outcome)) {
      // 残りも全滅するので打ち切る。掴んだままにしないよう未処理へ戻す
      const rest = claimed.slice(index + 1)
      logger.error({ channel, aborted: rest.length }, 'notify channel aborted')
      await prisma.notifyDelivery.updateMany({
        where: { id: { in: rest.map(({ id }) => id) } },
        data: { status: 'pending', claimedAt: null, attempts: { decrement: 1 } },
      })
      return
    }
  }
}

/** 役目を終えた行を片付ける。失敗した配信は原因を追えるよう一定期間残す */
const purge = async (now: Date): Promise<void> => {
  await prisma.notifyOutbox.deleteMany({ where: { status: 'done', deliveries: { none: {} } } })
  await prisma.notifyDelivery.deleteMany({
    where: { status: 'failed', createdAt: { lt: new Date(now.getTime() - NOTIFY_FAILED_RETENTION_MS) } },
  })
}

/**
 * 1 tick ぶんの処理。
 *
 * チャネル間は `Promise.allSettled` で並行に送り、片方のチャネルの失敗で
 * もう片方を止めない(既存の `notifyMention` と同じ判断)。
 */
export const runNotifyDispatch = async (now: Date = nowDate()): Promise<void> => {
  await reclaimStale(now)
  await fanoutOutbox(now)

  const results = await Promise.allSettled(NOTIFY_CHANNELS.map((channel) => deliverChannel(channel, now)))
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      logger.error({ error: result.reason, channel: NOTIFY_CHANNELS[index] }, 'notify channel delivery failed')
    }
  }

  await purge(now)
}
