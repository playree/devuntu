'use client'

import { useSyncExternalStore } from 'react'

/** メディアクエリに一致しているか。サーバーと初回のハイドレーションでは false */
export const useMediaQuery = (query: string): boolean =>
  useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
