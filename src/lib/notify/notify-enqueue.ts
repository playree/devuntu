/**
 * 通知の投入(サーバー専用)
 *
 * トリガー側はここへ「何が起きたか」を1行書くだけで、宛先の解決とチャネル別の配信は
 * ワーカー(`notify-dispatch.ts`)が行う。チケット操作と同じトランザクションで投入できるので、
 * 操作がロールバックされた場合に通知だけが残ることがない。
 */

import type { Prisma } from '@/generated/prisma/client'
import type { NotifyEvent } from '@/generated/prisma/enums'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { consumeRateLimit } from '../rate-limit'
import type { NotifyPayload } from './notify-payload'
import { kickNotifyDispatch } from './notify-worker'

/** 1 人の操作で作れるアウトボックスの上限。暴走時にキューを埋め尽くさないための歯止め */
const ENQUEUE_RATE_LIMIT = { limit: 120, windowMs: 60_000 }

export type EnqueueNotifyParam<E extends NotifyEvent = NotifyEvent> = {
  event: E
  /** 発生させた人。DM の宛先から除外する。システム由来の通知では省略する */
  actorId?: string | null
  /** トリガー側でしか決められない DM の宛先。actor 自身は呼び出し側で除いておく */
  targetUserIds?: string[]
  /** トリガー側でしか決められないチャンネルの宛先 */
  targetSlackChannelIds?: string[]
  payload: NotifyPayload<E>
}

/**
 * 通知を投入する。
 *
 * `tx` を渡すとそのトランザクションに乗る。宛先が 1 つも無い場合は行を作らない
 * (ワーカーが引いても展開する先が無く、キューを無駄に回すだけになる)。
 */
export const enqueueNotify = async <E extends NotifyEvent>(
  param: EnqueueNotifyParam<E>,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> => {
  const { event, actorId, targetUserIds = [], targetSlackChannelIds = [], payload } = param
  if (targetUserIds.length === 0 && targetSlackChannelIds.length === 0) {
    return
  }

  // 通知の欠落より外部サービスを叩き続ける方が重い、という既存の判断に合わせて投入を捨てる
  if (!consumeRateLimit(`notify:enqueue:${actorId ?? 'system'}`, ENQUEUE_RATE_LIMIT)) {
    logger.warn({ event, actorId }, 'notify enqueue throttled')
    return
  }

  const { id } = await tx.notifyOutbox.create({
    data: {
      event,
      actorId: actorId ?? null,
      targetUserIds,
      targetSlackChannelIds,
      payload: payload as Prisma.InputJsonValue,
    },
    select: { id: true },
  })
  logger.info({ outboxId: id, event, actorId, targetUserIds, targetSlackChannelIds }, 'notify enqueued')

  /**
   * tick を待たずに送るためレスポンス後の1周を予約する。
   * `tx` の中から呼んでも `after()` のコールバックはレスポンス後に走るので、
   * コミット前の行を読むことはない。
   */
  kickNotifyDispatch()
}
