/**
 * Web プッシュ通知の Service Worker。
 *
 * ルートスコープ(`/`)を取るため `public/` に置く。Next のビルド対象外なので、
 * ここでは素の JavaScript しか使えない(TypeScript / バンドラの機能は使えない)。
 */

/** 購読の再登録を報告する先。Service Worker から Server Action は呼べないので専用ルートを叩く */
const SUBSCRIBE_PATH = '/api/webpush/subscribe'

/** 再購読に使う VAPID 公開鍵の取得先。旧購読から鍵を引けない場合の頼り先 */
const KEY_PATH = '/api/webpush/key'

/** 鍵は ArrayBuffer で返るので、報告に載せるため base64url へ直す */
const toBase64Url = (buffer) => {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * base64url の公開鍵を `subscribe()` が要求するバイト列へ直す。
 *
 * `src/lib/webpush/webpush.ts` の `urlBase64ToUint8Array()` と同じ処理。ここは Next の
 * ビルド対象外で import できないため、同じものを持つ。
 */
const toApplicationServerKey = (base64Url) => {
  const padded = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), '=')
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i)
  }
  return bytes
}

/**
 * 再購読に使う鍵を決める。
 *
 * 旧購読が鍵を持っていればサーバーへ問い合わせずに済むが、ブラウザは前の購読を渡せない
 * ことがある(内部状態を失った場合)。鍵を省いて `subscribe()` を呼ぶと VAPID を要求する
 * プッシュサービスでは拒否されるため、その場合は実行時の鍵を引く。
 */
const applicationServerKey = async (oldSubscription) => {
  const known = oldSubscription && oldSubscription.options && oldSubscription.options.applicationServerKey
  if (known) {
    return known
  }

  const res = await fetch(KEY_PATH, { credentials: 'include' })
  if (!res.ok) {
    throw new Error(`web push key request failed: ${res.status}`)
  }
  const { publicKey } = await res.json()
  return toApplicationServerKey(publicKey)
}

const toPayload = (subscription, replacedEndpoint) => ({
  endpoint: subscription.endpoint,
  p256dh: toBase64Url(subscription.getKey('p256dh')),
  auth: toBase64Url(subscription.getKey('auth')),
  // 作り直しでエンドポイントが変わるため、報告しないと同じ端末の行が二重に残る
  replacedEndpoint: replacedEndpoint && replacedEndpoint !== subscription.endpoint ? replacedEndpoint : undefined,
})

/**
 * 待機せずに有効化する。
 *
 * 更新を配ったあと利用者がすべてのタブを閉じるまで古い Service Worker が残ると、
 * 通知の出方が端末ごとに食い違う。
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

/**
 * プッシュを受け取って通知を出す。
 *
 * `userVisibleOnly: true` で購読しているので、受け取ったら必ず通知を出さなければならない
 * (出さないとブラウザが「バックグラウンドで動作しました」の代替通知を出す)。
 * ペイロードが読めない場合も既定の文面で出す。
 */
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    // 想定外の形式。既定の文面で出す
  }

  const title = payload.title || 'Devuntu'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // 同じチケットの通知を積み上げない
      tag: payload.tag,
      data: { url: payload.url || '/' },
    }),
  )
})

/**
 * 通知のクリックで対象を開く。
 *
 * 既に開いているタブがあればそれを使い回す(タブが増え続けないようにする)。
 * 同一オリジンのタブが無い場合だけ新しく開く。
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    (async () => {
      const target = new URL(url, self.location.origin)
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

      for (const client of clients) {
        if (new URL(client.url).origin !== target.origin) {
          continue
        }
        await client.focus()
        // 別の画面を見ている場合は目的の画面へ移す
        if (client.url !== target.href && 'navigate' in client) {
          await client.navigate(target.href)
        }
        return
      }

      await self.clients.openWindow(target.href)
    })(),
  )
})

/**
 * プッシュサービス側の都合で購読が作り直されたときに、新しい購読を報告する。
 *
 * これを拾わないと、鍵が変わった端末へ送り続けて失効扱いになるまで通知が届かない。
 * セッション Cookie が必要なので `credentials: 'include'` で送る。
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const subscription =
        event.newSubscription ||
        (await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: await applicationServerKey(event.oldSubscription),
        }))
      if (!subscription) {
        return
      }

      const res = await fetch(SUBSCRIBE_PATH, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(toPayload(subscription, event.oldSubscription && event.oldSubscription.endpoint)),
      })
      /**
       * 報告できていないのに成功として終えると、サーバーには古い購読だけが残って
       * 通知が届かなくなる。理由は打てる手が変わるので状態を残す
       * (401 は次回のサインイン、404 は Web プッシュの構成、それ以外は再送で直る)。
       */
      if (!res.ok) {
        throw new Error(`web push resubscribe report failed: ${res.status}`)
      }
    })(),
  )
})
