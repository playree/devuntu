import { ReadonlyURLSearchParams } from 'next/navigation'

/**
 * 認証後の遷移先として安全な値だけを通す。
 *
 * `cb` はクエリ文字列で渡ってくる = 攻撃者が自由に指定できるため、検証せずに `router.push` すると
 * 「正規のサインイン画面でログインした直後に外部サイトへ飛ばされる」オープンリダイレクトになる。
 * 同一オリジンならパス(+クエリ/ハッシュ)へ畳み、他オリジン・`//host`・`javascript:` は落とす。
 */
export const safeCallbackPath = (raw: string | null | undefined, fallback: string = '/') => {
  if (!raw || typeof window === 'undefined') {
    return fallback
  }
  try {
    const url = new URL(raw, window.location.origin)
    if (url.origin !== window.location.origin) {
      return fallback
    }
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

export const makePath = (path: string, params?: Record<string, string> | ReadonlyURLSearchParams) => {
  if (params) {
    if (params instanceof ReadonlyURLSearchParams) {
      return `${path}?${params}`
    }
    const queryString = new URLSearchParams(params).toString()
    return `${path}?${queryString}`
  }
  return path
}
