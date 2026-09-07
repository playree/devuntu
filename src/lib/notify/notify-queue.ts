/**
 * キューの出し入れ(サーバー専用)
 *
 * 取り出しは `FOR UPDATE SKIP LOCKED` の生 SQL で行う。同じ行を 2 つのワーカーが同時に
 * 処理することが無いので、**リーダー選出の仕組みが要らない**(Prisma のコネクションプールでは
 * セッションレベルの advisory lock を保持できないため、そもそも採れない)。
 *
 * 掴んだ時点で `attempts` を加算するため、掴んだまま落ちた行を回収し続けても無限には試行しない。
 */

import type { NotifyEvent } from '@/generated/prisma/enums'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { NOTIFY_CLAIM_TIMEOUT_MS, NOTIFY_FAILED_RETENTION_MS, type NotifyChannel } from './notify'
import { isDeliveryAborting, isDeliverySettled, type DeliveryOutcome } from './notify-outcome'
import { isRetryExhausted, retryScheduledAt, staleClaimBefore } from './notify-schedule'

export type ClaimedOutbox = {
  id: string
  event: NotifyEvent
  actorId: string | null
  targetUserIds: string[]
  targetSlackChannelIds: string[]
  payload: unknown
}

export type ClaimedDelivery = {
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
 */
export const reclaimStale = async (now: Date): Promise<void> => {
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
export const claimOutbox = (limit: number) => prisma.$queryRaw<ClaimedOutbox[]>`
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

/** 期限が来た配信を掴む。アウトボックスの内容も一緒に引いて往復を減らす */
export const claimDeliveries = (channel: NotifyChannel, limit: number) => prisma.$queryRaw<ClaimedDelivery[]>`
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
    RETURNING "id", "channel", "userId", "slackChannelId", "attempts", "outboxId", "createdAt"
  )
  SELECT c."id", c."channel", c."userId", c."slackChannelId", c."attempts", o."event", o."payload"
  FROM claimed c JOIN "notify_outbox" o ON o."id" = c."outboxId"
  ORDER BY c."createdAt", c."id"
`

/**
 * 期限が来たメールの配信を**ユーザー単位でまとめて**掴む。
 *
 * 件数で切ると同じユーザーの通知がバッチ境界で 2 通に割れてしまうため、まず送る相手を
 * 待たせている順に選び、その相手の期限到来ぶんを全部掴む。
 *
 * メールの配信行は必ずユーザー宛(チャンネル通知は Slack だけ)なので、宛先の選定では
 * `userId` が入っている行だけを見る。
 */
export const claimEmailDeliveries = (userLimit: number) => prisma.$queryRaw<ClaimedDelivery[]>`
  WITH claimed AS (
    UPDATE "notify_delivery"
    SET "status" = 'processing', "claimedAt" = NOW(), "attempts" = "attempts" + 1
    WHERE "id" IN (
      SELECT "id" FROM "notify_delivery"
      WHERE "channel" = 'email' AND "status" = 'pending' AND "scheduledAt" <= NOW()
        AND "userId" IN (
          SELECT "userId" FROM "notify_delivery"
          WHERE "channel" = 'email' AND "status" = 'pending' AND "scheduledAt" <= NOW()
            AND "userId" IS NOT NULL
          GROUP BY "userId"
          ORDER BY MIN("scheduledAt"), MIN("id")
          LIMIT ${userLimit}
        )
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "channel", "userId", "slackChannelId", "attempts", "outboxId", "createdAt"
  )
  SELECT c."id", c."channel", c."userId", c."slackChannelId", c."attempts", o."event", o."payload"
  FROM claimed c JOIN "notify_outbox" o ON o."id" = c."outboxId"
  ORDER BY c."createdAt", c."id"
`

/** 送信結果に応じて配信行を片付ける */
export const settleDelivery = async (
  delivery: Pick<ClaimedDelivery, 'id' | 'attempts' | 'channel'>,
  outcome: DeliveryOutcome,
  now: Date,
): Promise<void> => {
  const { id, attempts, channel } = delivery

  if (isDeliverySettled(outcome)) {
    // 送信済み(または宛先が消えた)行は残す意味が無い。送信の記録はログにある
    await prisma.notifyDelivery.delete({ where: { id } })
    return
  }

  // トークン失効はこの tick では直らないので、試行回数を戻して次に回す
  if (isDeliveryAborting(outcome)) {
    await releaseDeliveries([id], outcome)
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
    data: { status: 'pending', claimedAt: null, scheduledAt: retryScheduledAt(now, attempts), lastError: outcome },
  })
}

/**
 * 掴んだまま送らなかった配信を未処理へ戻す。
 * 送っていないので試行回数も戻す(打ち切りで再試行の回数を使い切らせない)。
 */
export const releaseDeliveries = async (ids: string[], reason: DeliveryOutcome): Promise<void> => {
  if (ids.length === 0) {
    return
  }
  await prisma.notifyDelivery.updateMany({
    where: { id: { in: ids } },
    data: { status: 'pending', claimedAt: null, attempts: { decrement: 1 }, lastError: reason },
  })
}

/** 役目を終えた行を片付ける。失敗した配信は原因を追えるよう一定期間残す */
export const purge = async (now: Date): Promise<void> => {
  await prisma.notifyOutbox.deleteMany({ where: { status: 'done', deliveries: { none: {} } } })
  await prisma.notifyDelivery.deleteMany({
    where: { status: 'failed', createdAt: { lt: new Date(now.getTime() - NOTIFY_FAILED_RETENTION_MS) } },
  })
}
