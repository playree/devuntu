'use client'

import { authClient } from './auth/auth-client'
import { DEFAULT_TZ } from './day'

/**
 * ログイン中ユーザーのタイムゾーンを返すフック。
 * 未ログイン・未設定時は DEFAULT_TZ(Asia/Tokyo) にフォールバックする。
 * dayformat 等の第3引数に渡して日時表示をユーザーの TZ に合わせる用途。
 */
export const useUserTimezone = (): string => {
  const { data: session } = authClient.useSession()
  return session?.user.timezone ?? DEFAULT_TZ
}
