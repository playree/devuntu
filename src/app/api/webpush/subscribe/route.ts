/**
 * Web プッシュの購読を登録するルート。
 *
 * 通常の登録は `/account` の Server Action で行う。このルートが必要なのは
 * **Service Worker から Server Action を呼べない**ためで、`pushsubscriptionchange`
 * (プッシュサービス側の都合で購読が作り直された)の報告だけを受ける。
 *
 * `src/proxy.ts` の matcher は `api/` を除外しているので未認証でも到達する。
 * 門番はここでのセッション確認だけなので、確認を通す前に本文を解釈しない。
 */

import { getServerSession } from '@/lib/auth/auth'
import { logger } from '@/lib/logger'
import { scWebPushSubscription } from '@/lib/schema/schema-notify'
import { isWebPushConfigured, saveWebPushSubscription } from '@/lib/webpush/webpush-server'
import { NextResponse } from 'next/server'

export const POST = async (req: Request) => {
  const user = (await getServerSession())?.user
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  // 未構成の環境では購読を貯めても送る手段が無い
  if (!isWebPushConfigured()) {
    return NextResponse.json({ error: 'not_configured' }, { status: 404 })
  }

  const parsed = scWebPushSubscription.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }

  await saveWebPushSubscription(user.id, parsed.data)
  logger.info({ userId: user.id }, 'web push resubscribed')
  return NextResponse.json({ status: 'ok' })
}
