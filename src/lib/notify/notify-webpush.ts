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
import { deleteWebPushSubscription, findWebPushSubscriptions, sendWebPush } from '../webpush/webpush-server'
import type { NotifyContent } from './notify-content'
import { isDeliveryAborting, isDeliverySettled, type DeliveryOutcome } from './notify-outcome'

/**
 * 1 配信ぶんを、そのユーザーの全端末へ送る。
 *
 * 鍵の不正(401 / 403)は端末ごとにも起きる。VAPID 鍵を差し替えた後、再購読していない
 * 端末の行は古い鍵のまま残るので、**打ち切り相当でも残りの端末へは送り切ってから**
 * 構成障害かどうかを判断する。失効した端末を除いた全てが鍵の不正だった場合だけ
 * VAPID の構成障害とみなす。
 *
 * 結果は次の順で決める。
 *
 * - 失効を除く全端末が鍵の不正なら、そのまま打ち切りを伝える(チャネルごと止める)
 * - 1 台でも送れたら `ok`(再送すると届いた端末に二重で出てしまう)
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

  // 全端末の結果を見てから構成障害かを判断するため、先に送り切って結果を集める
  const results: { id: string; outcome: DeliveryOutcome }[] = []
  for (const subscription of subscriptions) {
    results.push({ id: subscription.id, outcome: await sendWebPush(subscription, message) })
  }

  const aborting = results.filter(({ outcome }) => isDeliveryAborting(outcome))
  // 失効(unlinked)は送信まで至っていないので、構成障害かどうかの判断材料にはしない
  const attempted = results.filter(({ outcome }) => outcome !== 'unlinked')

  // 送信を試せた端末が全て鍵の不正。端末ごとの問題ではなく VAPID の構成障害なので、直すまで送れない
  if (attempted.length > 0 && aborting.length === attempted.length) {
    return aborting[0].outcome
  }

  /**
   * 一部だけ鍵が不正な場合は、鍵を差し替える前に登録された購読が残っている。
   * 失効(404 / 410)にはならないので掃除されず、放っておくと毎回この端末で失敗する。
   */
  for (const { id } of aborting) {
    await deleteWebPushSubscription(id)
  }

  const delivered = results.filter(({ outcome }) => outcome === 'ok').length
  if (delivered > 0) {
    logger.info({ userId, delivered, devices: subscriptions.length }, 'web push notify')
    return 'ok'
  }

  // 失効(unlinked)はその端末だけの問題なので、配信の結果としては採らない
  const failure = results.find(({ outcome }) => !isDeliverySettled(outcome) && !isDeliveryAborting(outcome))
  return failure?.outcome ?? 'unlinked'
}
