'use client'

import { RefObject, useEffect, useEffectEvent } from 'react'

/** 描画の完了を確かめる間隔 */
const CHECK_INTERVAL = 250
/** 完了とみなすまでに条件を満たし続ける回数。MDXEditor は読み込み後も数フレームかけて本文を組み立てるため */
const STABLE_CHECKS = 2
/** 待つ上限。画像の取得失敗などで条件を満たさなくても、ここで打ち切って onReady を呼ぶ */
const MAX_WAIT = 10_000

/** Markdown の読み込み中プレースホルダが無く、画像もすべて読み終えているか */
const isRendered = (container: HTMLElement) =>
  !container.querySelector('[data-markdown-loading]') &&
  Array.from(container.querySelectorAll('img')).every((img) => img.complete)

/**
 * 印刷用ページの描画が終わったら onReady(印刷ダイアログ / HTML 保存)を 1 回だけ呼ぶ。
 * Markdown(動的 import)・画像・フォントを待たずに呼ぶと、未描画のまま保存されてしまう
 */
export const useWhenRendered = (ref: RefObject<HTMLElement | null>, enabled: boolean, onReady: () => void) => {
  const ready = useEffectEvent(onReady)

  useEffect(() => {
    if (!enabled) {
      return
    }

    let isCancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const startedAt = Date.now()
    let stableCount = 0

    const done = () => {
      // レイアウトの確定を待ってから呼ぶ(2 フレーム目で描画済みになる)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!isCancelled) {
            ready()
          }
        }),
      )
    }

    const check = () => {
      if (isCancelled) {
        return
      }
      const container = ref.current
      stableCount = container && isRendered(container) ? stableCount + 1 : 0
      if (stableCount >= STABLE_CHECKS || Date.now() - startedAt >= MAX_WAIT) {
        done()
        return
      }
      timer = setTimeout(check, CHECK_INTERVAL)
    }

    void document.fonts.ready.then(check)

    return () => {
      isCancelled = true
      clearTimeout(timer)
    }
  }, [ref, enabled])
}
