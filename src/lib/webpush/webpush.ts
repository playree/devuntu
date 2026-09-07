/**
 * Web プッシュの共通定義
 *
 * NOTE: このファイルはクライアント('use client')からも import されるため、
 * サーバー専用の処理(prisma / VAPID 鍵の参照 / 送信)は `webpush-server.ts` に配置する。
 */

/** Service Worker のスクリプト。ルートスコープを取るため `public/` に置く */
export const SERVICE_WORKER_PATH = '/sw.js'

/** 1ユーザーが登録できる購読(端末)の上限。超えた分は古い順に消す */
export const MAX_WEBPUSH_SUBSCRIPTIONS = 10

/** 端末名の上限。一覧で見分けるための自己申告なので短くてよい */
export const MAX_WEBPUSH_LABEL = 40

/** エンドポイントの上限。プッシュサービスの URL なので長くはならないが、際限なく保存させない */
export const MAX_WEBPUSH_ENDPOINT = 1000

/** 鍵の形式。`p256dh` / `auth` はどちらも base64url */
export const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/

/** ブラウザから受け取る購読。`PushSubscription.toJSON()` の必要な部分 */
export type WebPushSubscriptionInput = {
  endpoint: string
  p256dh: string
  auth: string
  label?: string
}

/**
 * プッシュで送るペイロード。Service Worker がそのまま `showNotification` へ渡す。
 *
 * 通知は端末のロック画面にも出るため、載せるのは通知本文と同じ範囲に留める。
 */
export type WebPushMessage = {
  title: string
  body: string
  /** クリックで開くURL */
  url: string
  /** 同じチケットの通知を積み上げないためのまとめキー */
  tag?: string
}

/**
 * VAPID 公開鍵(base64url)を `applicationServerKey` へ渡せる形に変換する。
 *
 * `pushManager.subscribe()` は BufferSource を要求し、base64url は受け付けない。
 * 戻り型を `ArrayBuffer` 裏付けの `Uint8Array` に固定しているのは、既定の
 * `ArrayBufferLike`(SharedArrayBuffer を含む)が `BufferSource` に代入できないため。
 */
export const urlBase64ToUint8Array = (base64Url: string): Uint8Array<ArrayBuffer> => {
  const padded = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), '=')
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i)
  }
  return bytes
}

/**
 * ブラウザが Web プッシュを扱えるか。
 *
 * iOS / iPadOS は 16.4 以降かつ**ホーム画面に追加した(standalone)場合だけ** `PushManager` が
 * 存在する。Safari のタブでは使えないので、この判定がそのまま案内の出し分けになる。
 */
export const isWebPushSupported = (): boolean =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window

/**
 * 端末名の候補を UA から作る。
 *
 * 一覧で「どの端末を解除するか」を見分けるためだけの表示で、認可には使わない。
 * 判別できない場合は空にして、画面側でエンドポイントの一部を出すなどに任せる。
 */
export const guessDeviceLabel = (userAgent: string): string => {
  const os = [
    ['iPhone', 'iPhone'],
    ['iPad', 'iPad'],
    ['Android', 'Android'],
    ['Macintosh', 'Mac'],
    ['Windows', 'Windows'],
    ['Linux', 'Linux'],
  ].find(([needle]) => userAgent.includes(needle))?.[1]

  // Edge / Chrome は互いの UA を含むので、限定的なものから先に見る
  const browser = [
    ['Edg/', 'Edge'],
    ['OPR/', 'Opera'],
    ['Firefox/', 'Firefox'],
    ['Chrome/', 'Chrome'],
    ['Safari/', 'Safari'],
  ].find(([needle]) => userAgent.includes(needle))?.[1]

  return [os, browser].filter(Boolean).join(' / ').slice(0, MAX_WEBPUSH_LABEL)
}
