/**
 * Web プッシュへの配信(サーバー専用)
 *
 * 送信の前提(VAPID の構成・通知 ON・購読が 1 件以上ある)は展開時(`notify-fanout.ts`)に
 * 確認済みなので、ここでは登録済みの端末へ順に送るだけ。
 *
 * 1 ユーザーが複数の端末を登録できるため、**配信 1 行に対して送信先が複数になる**。
 * 端末ごとに結果が違いうるので、まとめて 1 つの結果へ落とす。
 */

import { logger } from '../logger'
import { findWebPushSubscriptions, sendWebPush } from '../webpush/webpush-server'
import type { NotifyContent } from './notify-content'
import { isDeliveryAborting, isDeliverySettled, type DeliveryOutcome } from './notify-outcome'

/**
 * 1 配信ぶんを、そのユーザーの全端末へ送る。
 *
 * 結果は次の順で決める。
 *
 * - 1 台でも送れたら `ok`(再送すると届いた端末に二重で出てしまう)
 * - どれも送れず打ち切り相当(鍵の不正)があれば、そのまま打ち切りを伝える
 * - それ以外は最初の失敗を返して再試行に回す
 *
 * 失効した購読は `sendWebPush()` が行ごと消すので、次の通知では宛先から消えている。
 */
export const deliverWebPush = async (param: {
  userId: string
  content: NotifyContent
  /** 同じチケットの通知を積み上げないためのまとめキー */
  tag?: string
}): Promise<DeliveryOutcome> => {
  const { userId, content, tag } = param

  const subscriptions = await findWebPushSubscriptions(userId)
  if (subscriptions.length === 0) {
    // 展開後に全端末の購読が解除された場合。送る先が無いので諦める
    return 'unlinked'
  }

  const message = {
    title: content.subject,
    // 抜粋があれば通知本文に続けて出す(開かなくても内容が分かるようにする)
    body: content.excerpt ? `${content.body}\n${content.excerpt}` : content.body,
    url: content.url,
    ...(tag && { tag }),
  }

  let failure: DeliveryOutcome | null = null
  let delivered = 0

  for (const subscription of subscriptions) {
    const outcome = await sendWebPush(subscription, message)
    if (outcome === 'ok') {
      delivered += 1
      continue
    }
    // 失効(unlinked)はその端末だけの問題なので、他の端末の結果を上書きしない
    if (!isDeliverySettled(outcome)) {
      failure ??= outcome
    }
    if (isDeliveryAborting(outcome)) {
      // 鍵が不正なら残りの端末も全滅する
      break
    }
  }

  if (delivered > 0) {
    logger.info({ userId, delivered, devices: subscriptions.length }, 'web push notify')
    return 'ok'
  }
  return failure ?? 'unlinked'
}
