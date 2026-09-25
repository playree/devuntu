'use client'

import { useSyncExternalStore } from 'react'

const subscribeHash = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

/** 現在のハッシュ。SSR では空文字を返し、ハイドレーション後にクライアントの値へ切り替わる */
export const useLocationHash = () =>
  useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => '',
  )
