import { headers } from 'next/headers'
import { envu } from './env-util'

/**
 * クライアントIPを取得する(レート制限のキー用)。
 *
 * リバースプロキシ配下で動かす前提なので `x-forwarded-for` の先頭を採る。
 * ヘッダは詐称できるため認可には使わず、あくまで濫用のコストを上げる目的に留めること。
 * 取得できない場合は `unknown` を返し、その集合でまとめて制限が掛かるようにする。
 */
export const getClientIp = async () => {
  const headerList = await headers()
  const forwarded = headerList.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || headerList.get('x-real-ip')?.trim() || 'unknown'
}

export const makeUrl = (path: string, params?: Record<string, string>) => {
  const url = new URL(path, envu.server.BETTER_AUTH_URL)
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value)
    })
  }
  return url
}
