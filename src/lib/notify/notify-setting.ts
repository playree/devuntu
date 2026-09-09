/**
 * ユーザーごとの通知 ON/OFF(サーバー専用)
 *
 * 行が無い場合は全チャネル OFF として扱うオプトイン方式なので、
 * 全ユーザー分の初期行を作らずに済む。
 */

import type { NotifyEvent } from '@/generated/prisma/enums'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { DM_NOTIFY_EVENTS, type DmNotifyEvent, type NotifyChannel } from './notify'

export type NotifySetting = { [K in NotifyChannel]: boolean }

/** 行が無いイベントに使う既定値 */
const DEFAULT_SETTING: NotifySetting = { email: false, slack: false, webpush: false }

/**
 * 指定ユーザーの通知設定を DM 通知のイベント分返す。行が無いイベントは既定値(OFF)で埋める。
 */
export const getUserNotifySettings = async (userId: string): Promise<Record<DmNotifyEvent, NotifySetting>> => {
  const rows = await prisma.userNotifySetting.findMany({
    where: { userId },
    select: { event: true, email: true, slack: true, webpush: true },
  })
  const byEvent = new Map(rows.map(({ event, ...setting }) => [event, setting]))

  return Object.fromEntries(
    DM_NOTIFY_EVENTS.map((event) => [event, byEvent.get(event) ?? { ...DEFAULT_SETTING }]),
  ) as Record<DmNotifyEvent, NotifySetting>
}

/**
 * イベント分まとめて通知設定を保存する。画面が保存ボタンでの一括保存になったため、
 * 1件ずつではなくトランザクションでまとめて反映し、途中失敗で一部だけ保存された状態を避ける。
 */
export const setUserNotifySettings = async (
  userId: string,
  settings: ({ event: DmNotifyEvent } & NotifySetting)[],
): Promise<void> => {
  await prisma.$transaction(
    settings.map(({ event, ...setting }) =>
      prisma.userNotifySetting.upsert({
        where: { userId_event: { userId, event } },
        update: setting,
        create: { userId, event, ...setting },
      }),
    ),
  )
  logger.info({ userId, settings }, 'user notify settings updated')
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
