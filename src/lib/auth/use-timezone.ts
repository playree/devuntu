'use client'

import { createContext, useContext } from 'react'
import { DEFAULT_TZ } from '../day'
import { authClient } from './auth-client'

/** サーバーの既定タイムゾーン(env の DEFAULT_TIMEZONE)。ルートレイアウトから Providers 経由で配る */
export const DefaultTimezoneContext = createContext<string>(DEFAULT_TZ)

/** タイムゾーン未設定時のフォールバックに使う、サーバーの既定タイムゾーンを返すフック */
export const useDefaultTimezone = (): string => useContext(DefaultTimezoneContext)

/**
 * ログイン中ユーザーのタイムゾーンを返すフック。
 * 未ログイン・未設定時はサーバーの既定タイムゾーンにフォールバックする。
 * dayformat 等の第3引数に渡して日時表示をユーザーの TZ に合わせる用途。
 */
export const useUserTimezone = (): string => {
  const { data: session } = authClient.useSession()
  const defaultTz = useDefaultTimezone()
  return session?.user.timezone ?? defaultTz
}
