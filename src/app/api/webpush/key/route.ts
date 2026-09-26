/**
 * Web プッシュの VAPID 公開鍵を返すルート。
 *
 * 画面からの購読は Server Action(`getWebPushPublicKey`)で鍵を受け取るが、
 * `pushsubscriptionchange` の再購読は Service Worker が行うため Server Action を呼べない。
 * `event.oldSubscription` が無い場合(ブラウザが前の購読を渡せないことがある)に
 * `applicationServerKey` を埋められず再購読できないので、実行時の鍵をここから引く。
 *
 * `src/proxy.ts` は `api/` の認証を素通しにしているので未認証でも到達する。
 * 鍵自体は購読に載って外部のプッシュサービスへ渡る公開値だが、再購読の報告先
 * (`subscribe/route.ts`)がセッションを要求するので、ここも同じ門番に揃える。
 */

import { getServerSession } from '@/lib/auth/auth'
import { envu } from '@/lib/env-util'
import { isWebPushConfigured } from '@/lib/webpush/webpush-server'

export const GET = async () => {
  const user = (await getServerSession())?.user
  if (!user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!isWebPushConfigured()) {
    return Response.json({ error: 'not_configured' }, { status: 404 })
  }

  return Response.json({ publicKey: envu.server.VAPID_PUBLIC_KEY as string })
}
