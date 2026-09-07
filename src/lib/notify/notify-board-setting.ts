/**
 * ボードごとのチャネル通知設定(サーバー専用)
 *
 * 行が無いイベントは通知しないオプトイン方式なので、全ボード分の初期行を作らずに済む。
 * 宛先がユーザーではないため、ユーザーごとの通知設定(`notify-setting.ts`)とは独立している。
 *
 * イベントごとに別のチャンネルを持てるテーブルだが、画面では「通知先1つ + イベントの ON/OFF」
 * として扱う。有効なイベントの行へ同じチャンネルIDを書くので、イベント別チャンネルが必要に
 * なってもマイグレーションは要らない。
 */

import type { Prisma } from '@/generated/prisma/client'
import type { NotifyEvent } from '@/generated/prisma/enums'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { CHANNEL_NOTIFY_EVENTS, type ChannelNotifyEvent } from './notify'

/** ボードの設定。イベントごとの ON/OFF と、共通の通知先チャンネル */
export type BoardNotifySetting = {
  /** 通知先。1 件も設定が無ければ null */
  slackChannelId: string | null
  /** ON になっているイベント */
  events: ChannelNotifyEvent[]
}

/**
 * ボードの設定を読む。
 *
 * 行ごとに別のチャンネルを持てるので、画面へ返す通知先は最初の行のものに揃える
 * (画面からは常に全行へ同じ値を書くため、通常はすべて同じになる)。
 */
export const getBoardNotifySetting = async (boardId: string): Promise<BoardNotifySetting> => {
  const rows = await prisma.boardNotifySetting.findMany({
    where: { boardId },
    select: { event: true, slackChannelId: true },
    orderBy: { event: 'asc' },
  })

  const events = CHANNEL_NOTIFY_EVENTS.filter((event) => rows.some((row) => row.event === event))
  return { slackChannelId: rows[0]?.slackChannelId ?? null, events }
}

/**
 * ボードの設定を保存する。
 *
 * 「通知先なし」または「イベントが 1 つも ON でない」場合は行を全部消す(= 通知しない)。
 * 差分更新にせず総入れ替えにしているのは、部分更新の分岐を作らないため。
 */
export const setBoardNotifySetting = async (
  boardId: string,
  setting: { slackChannelId: string | null; events: readonly NotifyEvent[] },
  tx: Prisma.TransactionClient = prisma,
): Promise<void> => {
  const { slackChannelId } = setting
  // チャネル通知を持たないイベントが混ざっても保存しない(入口の検査と二重の歯止め)
  const events = CHANNEL_NOTIFY_EVENTS.filter((event) => setting.events.includes(event))

  await tx.boardNotifySetting.deleteMany({ where: { boardId } })
  if (slackChannelId && events.length > 0) {
    await tx.boardNotifySetting.createMany({
      data: events.map((event) => ({ boardId, event, slackChannelId })),
    })
  }

  logger.info({ boardId, slackChannelId, events }, 'board notify setting updated')
}

/**
 * 指定イベントの投稿先チャンネル。行が無ければ通知しないので空になる。
 *
 * 配信直前に引くので、設定を消した後に投入された分も送られない。
 */
export const getBoardNotifyChannels = async (boardId: string, event: NotifyEvent): Promise<string[]> => {
  const rows = await prisma.boardNotifySetting.findMany({
    where: { boardId, event },
    select: { slackChannelId: true },
  })
  return rows.map(({ slackChannelId }) => slackChannelId)
}
