/**
 * リクエストから表示ロケールを決める(Server Action / Route Handler 用)。
 *
 * `next/headers` に依存するので、通知の送信などリクエスト外からも呼ばれる `server.ts` とは分ける。
 * 判定は `LocaleProvider` と同じ `pickLocale` を通すので、画面の表示と食い違わない。
 */

import { pickLocale } from '@/lib/locale-util'
import { cookies, headers } from 'next/headers'
import { localeConfig } from './config'
import { defaultLocale } from './server'

export const requestLocale = async (): Promise<string> => {
  const acceptLanguage = (await headers()).get('accept-language')
  const cookieLocale = (await cookies()).get(localeConfig.cookie.name)?.value ?? null
  return pickLocale(localeConfig, defaultLocale, acceptLanguage, cookieLocale)
}
