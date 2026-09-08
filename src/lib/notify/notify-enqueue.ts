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
  /** 発生させた人。DM の宛先から除外する(展開時に効く)。システム由来の通知では省略する */
  actorId?: string | null
  /**
   * トリガー側でしか決められない DM の宛先。
   *
   * 規則で導ける宛先(依頼者・ボードの通知先チャンネル)は配信直前に `notify-recipient.ts`
   * が引くので、ここへは渡さない。
   */
  targetUserIds?: string[]
  payload: NotifyPayload<E>
}

/**
 * 通知を投入する。`tx` を渡すとそのトランザクションに乗る。
 *
 * 「送る相手がいるか」はここでは判断しない。規則で導く宛先(依頼者など)は配信直前に
 * 解決するので、投入の時点では宛先が空に見えることがある。無駄な行を作らない判断は
 * それを知っているトリガー側(`notify-trigger.ts`)が行う。
 */
export const enqueueNotify = async <E extends NotifyEvent>(
  param: EnqueueNotifyParam<E>,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> => {
  const { event, actorId, targetUserIds = [], payload } = param

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
      payload: payload as Prisma.InputJsonValue,
    },
    select: { id: true },
  })
  logger.info({ outboxId: id, event, actorId, targetUserIds }, 'notify enqueued')

  /**
   * tick を待たずに送るためレスポンス後の1周を予約する。
   * `tx` の中から呼んでも `after()` のコールバックはレスポンス後に走るので、
   * コミット前の行を読むことはない。
   */
  kickNotifyDispatch()
}
