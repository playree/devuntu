/**
 * 通知の配信ワーカー本体(サーバー専用)
 *
 * 1 tick で「回収 → 展開 → 配信 → パージ」を行う。`runNotifyDispatch()` は起動方法に
 * 依存しないので、アプリ内スケジューラ(`notify-worker.ts`)からでも、将来 HTTP
 * エンドポイントを足す場合でも同じものを呼べる。
 *
 * キューの出し入れ(取り出し・後片付け)は `notify-queue.ts` に置き、ここには流れだけを残す。
 */

import { nowDate } from '../day'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { consumeRateLimit } from '../rate-limit'
import {
  NOTIFY_CHANNEL_RATE_LIMIT,
  NOTIFY_CHANNELS,
  NOTIFY_DELIVER_BATCH,
  NOTIFY_FANOUT_BATCH,
  type NotifyChannel,
} from './notify'
import { buildNotifyContent } from './notify-content'
import { deliverEmail, findMailRecipient } from './notify-email'
import { buildDeliveries, createDeliveries } from './notify-fanout'
import { isDeliveryAborting, type DeliveryOutcome } from './notify-outcome'
import { parseNotifyPayload } from './notify-payload'
import {
  claimDeliveries,
  claimEmailDeliveries,
  claimOutbox,
  purge,
  reclaimStale,
  releaseDeliveries,
  settleDelivery,
  type ClaimedDelivery,
} from './notify-queue'
import { resolveNotifyTargets } from './notify-recipient'
import { deliverSlack } from './notify-slack'

/**
 * 掴んだアウトボックスを配信行へ展開する。
 *
 * 宛先が 1 つも残らなかった場合も `done` にする(送らないことは失敗ではない)。
 * ペイロードが壊れている行は文面を組み立てられないので `failed` にして残す。
 */
const fanoutOutbox = async (now: Date): Promise<void> => {
  const claimed = await claimOutbox(NOTIFY_FANOUT_BATCH)

  for (const outbox of claimed) {
    const { id, event, targetUserIds } = outbox
    try {
      const payload = parseNotifyPayload(event, outbox.payload)
      const targets = await resolveNotifyTargets(event, payload, { userIds: targetUserIds })
      const deliveries = await buildDeliveries({ outboxId: id, event, actorId: outbox.actorId, targets, now })

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

/** 宛先のロケール。チャンネル宛は解決する相手がいないので null(既定ロケール)になる */
const userLocale = async (userId: string): Promise<string | null> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { locale: true } })
  return user?.locale ?? null
}

/**
 * 配信行から文面を組み立てる。
 *
 * 同じイベントでも本人宛の DM と第三者が読むチャンネルでは文面が変わるので、
 * 宛先の種別を渡す(チャンネルIDが入っている行がチャンネル宛)。
 */
const contentOf = async (delivery: ClaimedDelivery, locale: string | null) =>
  buildNotifyContent(
    delivery.event,
    parseNotifyPayload(delivery.event, delivery.payload),
    locale,
    delivery.slackChannelId ? 'channel' : 'dm',
  )

/**
 * Slack へ逐次で送る。
 *
 * 並行に送らないのはワークスペース単位のバーストを避けるため(既存の方針を踏襲)。
 * トークン失効を掴んだ時点で残りも全滅するので、掴んだ分を未処理へ戻して打ち切る。
 */
const deliverSlackBatch = async (now: Date): Promise<void> => {
  const claimed = await claimDeliveries('slack', NOTIFY_DELIVER_BATCH.slack)

  for (const [index, delivery] of claimed.entries()) {
    const { userId, slackChannelId } = delivery
    let outcome: DeliveryOutcome
    try {
      const locale = userId ? await userLocale(userId) : null
      outcome = await deliverSlack({ userId, slackChannelId, content: await contentOf(delivery, locale), locale })
    } catch (error) {
      logger.error({ error, deliveryId: delivery.id }, 'notify delivery failed')
      outcome = 'failed'
    }
    await settleDelivery(delivery, outcome, now)

    if (isDeliveryAborting(outcome)) {
      const rest = claimed.slice(index + 1)
      logger.error({ channel: 'slack', aborted: rest.length }, 'notify channel aborted')
      await releaseDeliveries(
        rest.map(({ id }) => id),
        outcome,
      )
      return
    }
  }
}

/**
 * メールをユーザー単位でまとめて送る。
 *
 * 取り出しの時点で同じ相手の期限到来ぶんが揃っているので、ここでまとめれば
 * **ユーザーあたりウィンドウに 1 通**になる。宛先が引けない行は送る先が無いので諦める。
 */
const deliverEmailBatch = async (now: Date): Promise<void> => {
  const claimed = await claimEmailDeliveries(NOTIFY_DELIVER_BATCH.email)

  const byUser = new Map<string, ClaimedDelivery[]>()
  for (const delivery of claimed) {
    // 宛先が無いメール配信は送れない。展開時に必ず付けているので通常は起きない
    const key = delivery.userId
    if (!key) {
      await settleDelivery(delivery, 'unlinked', now)
      continue
    }
    byUser.set(key, [...(byUser.get(key) ?? []), delivery])
  }

  for (const [userId, deliveries] of byUser) {
    let outcome: DeliveryOutcome
    try {
      const recipient = await findMailRecipient(userId)
      outcome = recipient
        ? await deliverEmail({
            recipient,
            contents: await Promise.all(deliveries.map((delivery) => contentOf(delivery, recipient.locale))),
          })
        : 'unlinked'
    } catch (error) {
      logger.error({ error, userId }, 'notify delivery failed')
      outcome = 'failed'
    }

    // まとめて 1 通で送ったので、結果も同じものを全行へ反映する
    for (const delivery of deliveries) {
      await settleDelivery(delivery, outcome, now)
    }
  }
}

const DELIVERERS: Record<NotifyChannel, (now: Date) => Promise<void>> = {
  email: deliverEmailBatch,
  slack: deliverSlackBatch,
}

/** チャネル全体のスロットルを消費してから送る。超過した tick は次へ持ち越す */
const deliverChannel = async (channel: NotifyChannel, now: Date): Promise<void> => {
  if (!consumeRateLimit(`notify:${channel}`, NOTIFY_CHANNEL_RATE_LIMIT[channel])) {
    logger.warn({ channel }, 'notify channel throttled')
    return
  }
  await DELIVERERS[channel](now)
}

/**
 * 1 tick ぶんの処理。
 *
 * チャネル間は `Promise.allSettled` で並行に送り、片方のチャネルの失敗で
 * もう片方を止めない。
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
