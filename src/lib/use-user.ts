'use client'

import { authClient } from './auth-client'

/**
 * ログイン中ユーザーの userId を返すフック。
 * 未ログイン・セッション取得前は null を返す。
 * 「自分を選択」のようにクライアント側で本人判定をしたい場合に使う
 * (サーバーから prop で渡す経路は `getTicketFormOptions` の selfUserId を参照)。
 */
export const useSelfUserId = (): string | null => {
  const { data: session } = authClient.useSession()
  return session?.user.id ?? null
}
