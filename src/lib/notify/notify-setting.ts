/**
 * ユーザーごとの通知 ON/OFF(サーバー専用)
 *
 * 行が無い場合は全チャネル OFF として扱うオプトイン方式なので、
 * 全ユーザー分の初期行を作らずに済む。
 */

import type { NotifyEvent } from '@/generated/prisma/enums'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { NOTIFY_EVENTS, type NotifyChannel } from './notify'

export type NotifySetting = { [K in NotifyChannel]: boolean }

/** 行が無いイベントに使う既定値 */
const DEFAULT_SETTING: NotifySetting = { email: false, slack: false }

/**
 * 指定ユーザーの通知設定を全イベント分返す。行が無いイベントは既定値(OFF)で埋める。
 */
export const getUserNotifySettings = async (userId: string): Promise<Record<NotifyEvent, NotifySetting>> => {
  const rows = await prisma.userNotifySetting.findMany({
    where: { userId },
    select: { event: true, email: true, slack: true },
  })
  const byEvent = new Map(rows.map(({ event, email, slack }) => [event, { email, slack }]))

  return Object.fromEntries(
    NOTIFY_EVENTS.map((event) => [event, byEvent.get(event) ?? { ...DEFAULT_SETTING }]),
  ) as Record<NotifyEvent, NotifySetting>
}

/**
 * 1 イベント分の通知設定を保存する。チャネルは常に全部まとめて受け取り、
 * 部分更新の分岐を作らない。
 */
export const setUserNotifySetting = async (
  userId: string,
  event: NotifyEvent,
  setting: NotifySetting,
): Promise<void> => {
  await prisma.userNotifySetting.upsert({
    where: { userId_event: { userId, event } },
    update: setting,
    create: { userId, event, ...setting },
  })
  logger.info({ userId, event, ...setting }, 'user notify setting updated')
}

/**
 * 指定イベント・指定チャネルで通知を受け取るユーザーだけに絞り込む。
 *
 * 行が無い = OFF なので、ON の行だけを引いて残す(宛先の数だけ行を作らない)。
 */
export const filterNotifiable = async (
  userIds: string[],
  event: NotifyEvent,
  channel: NotifyChannel,
): Promise<string[]> => {
  if (userIds.length === 0) {
    return []
  }
  const enabled = await prisma.userNotifySetting.findMany({
    where: { userId: { in: userIds }, event, [channel]: true },
    select: { userId: true },
  })
  const enabledSet = new Set(enabled.map(({ userId }) => userId))
  return userIds.filter((userId) => enabledSet.has(userId))
}
