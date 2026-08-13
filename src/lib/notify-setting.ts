/**
 * ユーザーごとの通知 ON/OFF(サーバー専用)
 *
 * 行が無い場合は「ON」として扱うオプトアウト方式にしてある。連携したユーザーは
 * 通知を受け取りたいのが既定であり、全ユーザー分の初期行を作らずに済む。
 */

import type { NotifyEvent } from '@/generated/prisma/enums'
import { logger } from './logger'
import { prisma } from './prisma'
import { NOTIFY_EVENTS } from './slack'

export type NotifySetting = { slack: boolean }

/**
 * 指定ユーザーの通知設定を全イベント分返す。行が無いイベントは既定値(ON)で埋める。
 */
export const getUserNotifySettings = async (userId: string): Promise<Record<NotifyEvent, NotifySetting>> => {
  const rows = await prisma.userNotifySetting.findMany({
    where: { userId },
    select: { event: true, slack: true },
  })
  const byEvent = new Map(rows.map((row) => [row.event, row]))

  return Object.fromEntries(
    NOTIFY_EVENTS.map((event) => [event, { slack: byEvent.get(event)?.slack ?? true }]),
  ) as Record<NotifyEvent, NotifySetting>
}

/**
 * 1 イベント分の通知設定を保存する。
 */
export const setUserNotifySetting = async (userId: string, event: NotifyEvent, slack: boolean): Promise<void> => {
  await prisma.userNotifySetting.upsert({
    where: { userId_event: { userId, event } },
    update: { slack },
    create: { userId, event, slack },
  })
  logger.info({ userId, event, slack }, 'user notify setting updated')
}

/**
 * 指定イベントで Slack 通知を受け取るユーザーだけに絞り込む。
 *
 * 行が無い = ON なので、OFF の行だけを引いて除外する(宛先の数だけ行を作らない)。
 */
export const filterSlackNotifiable = async (userIds: string[], event: NotifyEvent): Promise<string[]> => {
  if (userIds.length === 0) {
    return []
  }
  const muted = await prisma.userNotifySetting.findMany({
    where: { userId: { in: userIds }, event, slack: false },
    select: { userId: true },
  })
  const mutedSet = new Set(muted.map(({ userId }) => userId))
  return userIds.filter((userId) => !mutedSet.has(userId))
}
