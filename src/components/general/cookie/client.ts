'use client'

import { SerializeOptions, stringifySetCookie } from 'cookie'

export const getCookies = () => {
  const cookies: Record<string, string> = {}
  if (typeof window === 'undefined') {
    return cookies
  }

  const documentCookies = document.cookie ? document.cookie.split(';') : []
  for (const cookieKV of documentCookies) {
    const kv = cookieKV.trim().split(/(?<=^[^=]+?)=/)
    cookies[kv[0]] = kv[1]
  }
  return cookies
}

export const getCookie = (key: string) => getCookies()[key]

export const setCookie = (key: string, value: string, options?: SerializeOptions) => {
  const { encode, ...attrs } = options ?? {}
  document.cookie = stringifySetCookie({ name: key, value, ...attrs }, { encode })
}
