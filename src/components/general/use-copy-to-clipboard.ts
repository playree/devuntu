'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * クリップボードへのコピーと「コピーしました」表示の状態。
 * isCopied は resetMs 後に false へ戻る。
 */
export const useCopyToClipboard = (resetMs = 2000) => {
  const [isCopied, setIsCopied] = useState(false)
  // 表示中に閉じられたモーダルなどでアンマウント後に setState しないよう片付ける
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  /** コピーできたかを返す。失敗時は成功表示を出さないことで伝える */
  const copy = useCallback(
    async (text: string) => {
      try {
        // 安全なコンテキスト(https / localhost)の外では navigator.clipboard 自体が無く、参照だけで例外になる
        await navigator.clipboard.writeText(text)
      } catch {
        return false
      }
      setIsCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setIsCopied(false), resetMs)
      return true
    },
    [resetMs],
  )

  return { isCopied, copy }
}
