/**
 * 通知の共通定義
 *
 * NOTE: このファイルはクライアント('use client')からも import されるため、
 * サーバー専用の処理は `notify-setting.ts`(設定の読み書き) や
 * `notify-mention.ts`(送信) に配置する。
 */

import type { NotifyEvent } from '@/generated/prisma/enums'

/** 通知イベントの種別。Prisma の enum と同じ並びで持つ(tests/lib/notify.test.ts で一致を固定する) */
export const NOTIFY_EVENTS = ['mention'] as const satisfies readonly NotifyEvent[]

/** 通知チャネル。UserNotifySetting の列名と一致させる */
export const NOTIFY_CHANNELS = ['email', 'slack'] as const
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number]

/** 1回の通知で送る宛先の上限。暴走時に外部サービスを叩き続けないための歯止め */
export const MAX_NOTIFY_RECIPIENTS = 20
