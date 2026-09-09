/**
 * Web プッシュのブラウザ側の操作
 *
 * NOTE: `navigator` / `Notification` に触るためブラウザでしか動かない。
 * 純粋な判定は `webpush.ts`、送信は `webpush-server.ts` に配置する。
 */

import {
  guessDeviceLabel,
  isIos,
  isSameApplicationServerKey,
  isWebPushSupported,
  LocalSubscription,
  SERVICE_WORKER_PATH,
  toBase64Url,
  urlBase64ToUint8Array,
  WebPushSubscriptionInput,
  WebPushSupport,
} from './webpush'

/** ホーム画面から起動しているか(standalone) */
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  // iOS Safari は display-mode を返さないことがあるので独自プロパティも見る
  ('standalone' in window.navigator && window.navigator.standalone === true)

/** この環境で Web プッシュを使えるか。iOS はホーム画面に追加すれば使えるので案内を分ける */
export const detectWebPushSupport = (): WebPushSupport => {
  if (isWebPushSupported()) {
    return 'ok'
  }
  return isIos(navigator.userAgent, navigator.maxTouchPoints) && !isStandalone() ? 'ios-standalone' : 'unsupported'
}

/** 画面の出し分けに必要なブラウザ側の状態 */
export type LocalWebPushState = {
  support: WebPushSupport
  /** 通知権限。`Notification` が無い環境は 'default' として扱う */
  permission: NotificationPermission
  /** この端末の購読。Service Worker が未登録なら null */
  subscription: LocalSubscription | null
}

/**
 * この端末の購読を読む。
 *
 * 判定のために Service Worker を登録しない(通知を使わない利用者に入れない)。
 * `navigator.serviceWorker.ready` は登録が無いと永久に解決しないので使えず、
 * `getRegistration()` は引数を省くと現在の URL を覆う登録を返し、無ければ undefined で解決する。
 */
const readSubscription = async (publicKey: string): Promise<LocalSubscription | null> => {
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) {
    return null
  }
  return {
    endpoint: subscription.endpoint,
    isCurrentKey: isSameApplicationServerKey(
      subscription.options.applicationServerKey,
      urlBase64ToUint8Array(publicKey),
    ),
  }
}

/** 画面の出し分けに必要なブラウザ側の状態をまとめて読む */
export const readLocalWebPushState = async (publicKey: string): Promise<LocalWebPushState> => {
  const support = detectWebPushSupport()
  const permission = typeof Notification === 'undefined' ? 'default' : Notification.permission
  if (support !== 'ok') {
    return { support, permission, subscription: null }
  }
  try {
    return { support, permission, subscription: await readSubscription(publicKey) }
  } catch (error) {
    // 読めない環境。未登録として扱えば登録ボタンから復帰できる
    console.error(error)
    return { support, permission, subscription: null }
  }
}

/** 登録に載せる購読の内容 */
export type LocalSubscriptionPayload = WebPushSubscriptionInput & { replacedEndpoint?: string }

/**
 * ブラウザ側の購読を作る。
 *
 * 鍵の不一致やプッシュサービスへ到達できない場合は例外になるが、利用者に打てる手が
 * 無いので理由は分けず呼び出し側で `failed` にまとめる(詳細はコンソールに残す)。
 */
export const subscribeLocalPush = async (publicKey: string): Promise<LocalSubscriptionPayload> => {
  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH)
  // 登録直後は activate 前で pushManager を触れないことがある
  await navigator.serviceWorker.ready

  const applicationServerKey = urlBase64ToUint8Array(publicKey)
  /**
   * 鍵を差し替えた後は古い購読が残っていると購読し直せないので、先に解除する。
   * 解除した購読はサーバー側にも残るため、エンドポイントを報告して消してもらう。
   */
  const current = await registration.pushManager.getSubscription()
  let replacedEndpoint: string | undefined
  if (current && !isSameApplicationServerKey(current.options.applicationServerKey, applicationServerKey)) {
    replacedEndpoint = current.endpoint
    await current.unsubscribe()
  }

  const subscription = await registration.pushManager.subscribe({
    // ブラウザの要件。受け取ったら必ず通知を出す(Service Worker 側で守る)
    userVisibleOnly: true,
    applicationServerKey,
  })
  return {
    endpoint: subscription.endpoint,
    p256dh: toBase64Url(subscription.getKey('p256dh')),
    auth: toBase64Url(subscription.getKey('auth')),
    label: guessDeviceLabel(navigator.userAgent) || undefined,
    replacedEndpoint,
  }
}

/**
 * この端末の購読を解除する。
 *
 * サーバーの行を消しただけではブラウザの購読が残り、`pushsubscriptionchange` で
 * 作り直された購読が再登録されて行が復活しうる。
 * 別の端末の行を消したときに解除してしまわないよう、エンドポイントの一致を条件にする。
 * 失敗しても利用者に打てる手が無いので投げない。
 */
export const unsubscribeLocalPush = async (endpoint: string): Promise<void> => {
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription || subscription.endpoint !== endpoint) {
      return
    }
    await subscription.unsubscribe()
  } catch (error) {
    console.error(error)
  }
}
