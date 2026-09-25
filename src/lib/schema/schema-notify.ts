/**
 * 通知設定と Web プッシュ購読の入力スキーマ
 */

import { el } from '@/locale'
import { z } from 'zod'
import { DM_NOTIFY_EVENTS } from '../notify/notify'
import { BASE64URL_PATTERN, MAX_WEBPUSH_ENDPOINT, MAX_WEBPUSH_LABEL } from '../webpush/webpush'
import { isAllowedWebPushEndpoint } from '../webpush/webpush-endpoint'

/**
 * 通知設定(イベント種別ごと・チャネルごとの ON/OFF)。種別が増えても z.enum が自動で追従する。
 * チャネルは常に全部まとめて受け取り、サーバー側に部分更新の分岐を作らない。
 *
 * 宛先がチャンネルだけのイベントは `UserNotifySetting` で表せないので受け付けない。
 */
export const scUpdateNotifySetting = z.object({
  event: z.enum(DM_NOTIFY_EVENTS),
  email: z.boolean(),
  slack: z.boolean(),
  webpush: z.boolean(),
})
export type UpdateNotifySetting = z.infer<typeof scUpdateNotifySetting>

/**
 * 通知設定の一括保存。画面は切り替え即保存ではなく保存ボタン押下でイベント分をまとめて送る。
 *
 * イベントごとにちょうど1件だけ受け取る。空・部分・重複を許すと、保存側の
 * トランザクションに入る upsert 件数を呼び出し側が自由に増やせてしまう。
 */
export const scUpdateNotifySettings = z.object({
  settings: z
    .array(scUpdateNotifySetting)
    .length(DM_NOTIFY_EVENTS.length, el('@invalid_notify_setting'))
    .refine(
      (settings) => new Set(settings.map(({ event }) => event)).size === settings.length,
      el('@invalid_notify_setting'),
    ),
})
export type UpdateNotifySettings = z.infer<typeof scUpdateNotifySettings>

/**
 * Web プッシュの購読。ブラウザの `PushSubscription` から必要な値だけを受け取る。
 *
 * エンドポイントはプッシュサービスの URL で、購読の同一性もこれで決まる。
 * 送信時に `web-push` がそのまま接続先にするため、内部を指す URL を保存させない
 * (`isAllowedWebPushEndpoint()`)。
 */
const zWebPushEndpoint = z
  .url()
  .max(MAX_WEBPUSH_ENDPOINT)
  .refine(isAllowedWebPushEndpoint, el('@invalid_webpush_subscription'))

export const scWebPushSubscription = z.object({
  endpoint: zWebPushEndpoint,
  /**
   * この購読を作るために解除した古い購読のエンドポイント。
   *
   * 同じ端末を指す行が残ると、送れない宛先へ送り続けることになるので消す。
   */
  replacedEndpoint: zWebPushEndpoint.optional(),
  /** UA の公開鍵(非圧縮点 65 バイトの base64url) */
  p256dh: z.string().regex(BASE64URL_PATTERN, el('@invalid_webpush_subscription')).max(200),
  /** 共有秘密(16 バイトの base64url) */
  auth: z.string().regex(BASE64URL_PATTERN, el('@invalid_webpush_subscription')).max(100),
  /** 一覧で端末を見分けるための自己申告 */
  label: z.string().max(MAX_WEBPUSH_LABEL).optional(),
})
export type WebPushSubscriptionInput = z.infer<typeof scWebPushSubscription>
