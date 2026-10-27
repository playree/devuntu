import { headers } from 'next/headers'
import { envu } from './env-util'

/**
 * `x-forwarded-for` から、信頼するプロキシが記録したクライアントIPを選ぶ。
 *
 * 付け足し型のプロキシ(nginx の `$proxy_add_x_forwarded_for` など)は受け取った値の末尾に
 * 接続元を足すため、先頭はクライアントが自由に決められる。信頼できるのは末尾から
 * `trustedProxyCount` 番目(最も外側の信頼するプロキシが記録した接続元)なので、そこを採る。
 * 要素が足りない場合は先頭を採る。
 */
export const pickForwardedClientIp = (forwardedFor: string, trustedProxyCount: number) => {
  const ips = forwardedFor
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean)
  return ips[Math.max(ips.length - trustedProxyCount, 0)]
}

/**
 * クライアントIPを取得する(レート制限のキー用)。
 *
 * リバースプロキシ配下で動かす前提で、`x-forwarded-for` の末尾から信頼するプロキシの段数
 * (`TRUSTED_PROXY_COUNT`)番目を採る。
 * ヘッダは詐称できるため認可には使わず、あくまで濫用のコストを上げる目的に留めること。
 * 取得できない場合は `unknown` を返し、その集合でまとめて制限が掛かるようにする。
 */
export const getClientIp = async () => {
  const headerList = await headers()
  const forwardedFor = headerList.get('x-forwarded-for')
  const forwarded = forwardedFor ? pickForwardedClientIp(forwardedFor, envu.server.TRUSTED_PROXY_COUNT) : undefined
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
