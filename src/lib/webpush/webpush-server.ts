/**
 * Web プッシュの送信と購読の管理(サーバー専用)
 *
 * 送信は `web-push` に任せる(RFC 8291 の本文暗号化と RFC 8292 の VAPID JWT)。
 * 結果は Slack と同じ語彙(`DeliveryOutcome`)へ落とし、再試行の判断を通知側の 1 箇所に保つ。
 *
 * prisma / 環境変数に依存するため、クライアントからは import しないこと
 * (クライアント安全な定数・型は `webpush.ts` を参照)。
 */

import webpush, { WebPushError } from 'web-push'
import { envu } from '../env-util'
import { logger } from '../logger'
import type { DeliveryOutcome } from '../notify/notify-outcome'
import { prisma } from '../prisma'
import { MAX_WEBPUSH_LABEL, MAX_WEBPUSH_SUBSCRIPTIONS, type WebPushMessage } from './webpush'
import { isAllowedWebPushEndpoint } from './webpush-endpoint'

/** 送信のタイムアウト。Slack と同じ歯止めに揃える */
const SEND_TIMEOUT_MS = 5000

/**
 * VAPID 鍵が揃っているか。1 つでも欠けると購読も送信も成立しない。
 *
 * 未構成の環境では購読 UI ごと出さず、通知も送信を試みずスキップする
 * (`isMailConfigured()` と同じ扱い)。
 */
export const isWebPushConfigured = () => !!envu.server.VAPID_PUBLIC_KEY && !!envu.server.VAPID_PRIVATE_KEY

/**
 * VAPID の詳細を設定する。
 *
 * `web-push` はモジュール全体の状態として持つので、送信のたびに入れ直して
 * 環境変数の差し替え(再起動なしの検証)にも追従させる。
 */
const applyVapidDetails = () => {
  webpush.setVapidDetails(
    envu.server.VAPID_SUBJECT,
    envu.server.VAPID_PUBLIC_KEY as string,
    envu.server.VAPID_PRIVATE_KEY as string,
  )
}

/**
 * HTTP ステータスを再試行の判断へ落とす。
 *
 * 未知のステータスは 'failed' に寄せて送信を止めない(仕様が増えても壊れないようにする)。
 */
export const classifyWebPushStatus = (statusCode: number | undefined): DeliveryOutcome => {
  switch (statusCode) {
    // 購読が失効している。その端末だけ諦めて行を消す
    case 404:
    case 410:
      return 'unlinked'
    // 鍵が違う / 権限が無い。他の購読も同じ鍵なので全滅する
    case 401:
    case 403:
      return 'revoked'
    case 429:
      return 'rate_limited'
    default:
      if (statusCode && statusCode >= 500) {
        return 'retryable'
      }
      return 'failed'
  }
}

export type StoredSubscription = { id: string; endpoint: string; p256dh: string; auth: string }

/** 通知を受け取る端末の購読。1 件も無ければ送る先が無い */
export const findWebPushSubscriptions = async (userId: string): Promise<StoredSubscription[]> =>
  prisma.webPushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
    // 上限で切り詰めるときに落ちる端末が実行ごとに変わらないよう順序を固定する
    orderBy: { id: 'asc' },
  })

/**
 * 1 購読へ送る。
 *
 * 失効(404 / 410)を掴んだら購読の行を消す。プッシュサービスは購読を無効にした時点で
 * これを返すので、放っておくと失敗する宛先を送り続けることになる。
 */
export const sendWebPush = async (
  subscription: StoredSubscription,
  message: WebPushMessage,
): Promise<DeliveryOutcome> => {
  /**
   * 保存時にも検査しているが、検査を入れる前に登録された行が残っていることがある。
   * 送る先が無いのと同じなので行ごと消す(再登録すれば正しい購読で入り直す)。
   */
  if (!isAllowedWebPushEndpoint(subscription.endpoint)) {
    logger.warn({ subscriptionId: subscription.id }, 'web push endpoint rejected')
    await deleteWebPushSubscription(subscription.id)
    return 'unlinked'
  }

  applyVapidDetails()

  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(message),
      { TTL: 60 * 60 * 24, timeout: SEND_TIMEOUT_MS },
    )
    await prisma.webPushSubscription
      .update({ where: { id: subscription.id }, data: { lastUsedAt: new Date() } })
      // 送信の後始末で通知そのものを失敗させない(購読が同時に解除された場合など)
      .catch(() => undefined)
    return 'ok'
  } catch (error) {
    const outcome = error instanceof WebPushError ? classifyWebPushStatus(error.statusCode) : 'failed'
    logger.warn(
      { outcome, statusCode: error instanceof WebPushError ? error.statusCode : undefined },
      'web push failed',
    )

    if (outcome === 'unlinked') {
      await deleteWebPushSubscription(subscription.id)
    }
    return outcome
  }
}

/** 失効した購読を消す。既に消えていても失敗にしない */
export const deleteWebPushSubscription = async (id: string): Promise<void> => {
  await prisma.webPushSubscription.delete({ where: { id } }).catch(() => undefined)
  logger.info({ subscriptionId: id }, 'web push subscription removed')
}

/**
 * 購読を登録する。
 *
 * 購読の同一性はエンドポイントで決まるので、同じ端末から登録し直しても行は増えない。
 * 鍵は再購読で変わるため、既存の行があっても上書きする。
 *
 * `replacedEndpoint` は解除済みの古い購読。VAPID 鍵を差し替えた場合の再購読では
 * エンドポイントごと変わるため、消さないと同じ端末の行が二重に残る。鍵違いの購読は
 * 送信が 401 で落ちるだけで失効(404 / 410)として掃除されないので、ここで消す。
 */
export const saveWebPushSubscription = async (
  userId: string,
  input: { endpoint: string; p256dh: string; auth: string; label?: string; replacedEndpoint?: string },
): Promise<void> => {
  const { endpoint, p256dh, auth, replacedEndpoint } = input
  const label = input.label?.slice(0, MAX_WEBPUSH_LABEL) || null

  await prisma.webPushSubscription.upsert({
    where: { endpoint },
    // 別のユーザーが同じエンドポイントを持つことは無いが、端末を渡した場合に持ち主を移す
    update: { userId, p256dh, auth, label },
    create: { userId, endpoint, p256dh, auth, label },
  })

  if (replacedEndpoint && replacedEndpoint !== endpoint) {
    // 他人の行を消せないよう userId も条件に含める
    const { count } = await prisma.webPushSubscription.deleteMany({
      where: { endpoint: replacedEndpoint, userId },
    })
    if (count > 0) {
      logger.info({ userId }, 'web push subscription replaced')
    }
  }

  await pruneWebPushSubscriptions(userId)
  logger.info({ userId }, 'web push subscription saved')
}

/**
 * 上限を超えた購読を古い順に消す。
 *
 * 端末を買い替えるたびに購読が積み上がると、1 回の通知で叩く先が際限なく増えてしまう。
 */
const pruneWebPushSubscriptions = async (userId: string): Promise<void> => {
  const stale = await prisma.webPushSubscription.findMany({
    where: { userId },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
    skip: MAX_WEBPUSH_SUBSCRIPTIONS,
  })
  if (stale.length === 0) {
    return
  }
  await prisma.webPushSubscription.deleteMany({ where: { id: { in: stale.map(({ id }) => id) } } })
  logger.info({ userId, removed: stale.length }, 'web push subscriptions pruned')
}
