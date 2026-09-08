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
import { consumeRateLimit, remainingRateLimit } from '../rate-limit'
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
import { parseNotifyPayload, type NotifyPayload } from './notify-payload'
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
} from './notify-queue'
import { resolveNotifyTargets } from './notify-recipient'
import { deliverSlack } from './notify-slack'
import { deliverWebPush } from './notify-webpush'

/**
 * 掴んだアウトボックスを配信行へ展開する。
 *
 * 宛先が 1 つも残らなかった場合も `done` にする(送らないことは失敗ではない)。
 *
 * 失敗の扱いは原因で分ける。ペイロードが壊れている行は掴み直しても直らないので即 `failed`、
 * 宛先の解決や配信行の作成(どちらも DB に触る)で落ちた分は一時障害の可能性があるので
 * 試行回数を使い切るまで未処理へ戻す。
 */
const fanoutOutbox = async (now: Date): Promise<void> => {
  const claimed = await claimOutbox(NOTIFY_FANOUT_BATCH)

  for (const outbox of claimed) {
    const { id, event, targetUserIds } = outbox

    // 文面を組み立てられない行は再試行しても同じ結果になる
    let payload: NotifyPayload
    try {
      payload = parseNotifyPayload(event, outbox.payload)
    } catch (error) {
      logger.error({ error, outboxId: id, event }, 'notify payload invalid')
      await failOutbox(outbox, now)
      continue
    }

    try {
      const targets = await resolveNotifyTargets(event, payload, { userIds: targetUserIds })
      const deliveries = await buildDeliveries({ outboxId: id, event, actorId: outbox.actorId, targets, now })

      await prisma.$transaction(async (tx) => {
        await createDeliveries(deliveries, tx)
        await tx.notifyOutbox.update({ where: { id }, data: { status: 'done', claimedAt: null } })
      })
      logger.info({ outboxId: id, event, deliveries: deliveries.length }, 'notify fanned out')
    } catch (error) {
      logger.error({ error, outboxId: id, event }, 'notify fanout failed')
      await settleOutbox(outbox, now)
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
const deliverSlackBatch = async (now: Date, limit: number): Promise<number> => {
  const claimed = await claimDeliveries('slack', limit)

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
      // 送らずに戻した分は枠を使っていない
      return index + 1
    }
  }
  return claimed.length
}

/**
 * メールをユーザー単位でまとめて送る。
 *
 * 取り出しの時点で同じ相手の期限到来ぶんが揃っているので、ここでまとめれば
 * **ユーザーあたりウィンドウに 1 通**になる。宛先が引けない行は送る先が無いので諦める。
 */
const deliverEmailBatch = async (now: Date, limit: number): Promise<number> => {
  const claimed = await claimEmailDeliveries(limit)

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

  // ユーザーあたり 1 通なので、送信数は宛先ユーザー数
  return byUser.size
}

/**
 * Web プッシュを送る。
 *
 * 宛先は必ずユーザー(チャンネル通知は Slack だけ)。1 配信で登録済みの全端末へ送るので、
 * ここでは配信行を 1 つずつ処理する。
 */
const deliverWebPushBatch = async (now: Date, limit: number): Promise<number> => {
  const claimed = await claimDeliveries('webpush', limit)

  for (const [index, delivery] of claimed.entries()) {
    const { userId } = delivery
    let outcome: DeliveryOutcome
    try {
      if (!userId) {
        outcome = 'unlinked'
      } else {
        const locale = await userLocale(userId)
        outcome = await deliverWebPush({
          userId,
          content: await contentOf(delivery, locale),
          // 同じチケットの通知を積み上げない
          tag: ticketTagOf(delivery),
        })
      }
    } catch (error) {
      logger.error({ error, deliveryId: delivery.id }, 'notify delivery failed')
      outcome = 'failed'
    }
    await settleDelivery(delivery, outcome, now)

    if (isDeliveryAborting(outcome)) {
      // VAPID 鍵が不正なら残りも全滅する
      const rest = claimed.slice(index + 1)
      logger.error({ channel: 'webpush', aborted: rest.length }, 'notify channel aborted')
      await releaseDeliveries(
        rest.map(({ id }) => id),
        outcome,
      )
      // 送らずに戻した分は枠を使っていない
      return index + 1
    }
  }
  return claimed.length
}

/** 通知のまとめキー。同じチケットの通知は端末上で 1 件に畳まれる */
const ticketTagOf = (delivery: ClaimedDelivery): string | undefined => {
  const payload = parseNotifyPayload(delivery.event, delivery.payload)
  return payload.ticketId
}

/** 引数は 1 周で扱う上限、戻り値は実際に送った件数(= 消費する枠) */
const DELIVERERS: Record<NotifyChannel, (now: Date, limit: number) => Promise<number>> = {
  email: deliverEmailBatch,
  slack: deliverSlackBatch,
  webpush: deliverWebPushBatch,
}

/**
 * チャネル全体のスロットルの枠内で送る。
 *
 * 1 周で最大 `NOTIFY_DELIVER_BATCH` 件送るため、tick ごとに 1 件だけ消費すると枠が実際の
 * 送信数を数えられない。残枠とバッチ上限の小さい方を取り出しの上限にし、送った件数ぶんを
 * 消費する。枠が空の tick は何も送らず次へ持ち越す。
 */
const deliverChannel = async (channel: NotifyChannel, now: Date): Promise<void> => {
  const key = `notify:${channel}`
  const rule = NOTIFY_CHANNEL_RATE_LIMIT[channel]

  const limit = Math.min(remainingRateLimit(key, rule), NOTIFY_DELIVER_BATCH[channel])
  if (limit <= 0) {
    logger.warn({ channel }, 'notify channel throttled')
    return
  }

  const sent = await DELIVERERS[channel](now, limit)
  if (sent > 0) {
    consumeRateLimit(key, rule, sent)
  }
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
