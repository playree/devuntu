'use client'

import { useEffect, useRef } from 'react'

/**
 * 有効な間、Ctrl+S(macOS は Cmd+S)で `onSave` を呼ぶ。
 * ブラウザの「ページを保存」は保存できない状態でも止める(`onSave` 側で保存するかを判断する)。
 * エディタ(CodeMirror / MDXEditor)より先に受け取るため、document の capture で拾う
 */
export const useSaveShortcut = ({ isActive, onSave }: { isActive: boolean; onSave: () => void }) => {
  // リスナーを張り直さずに最新の保存処理を使う
  const onSaveRef = useRef(onSave)
  useEffect(() => {
    onSaveRef.current = onSave
  })

  useEffect(() => {
    if (!isActive) {
      return
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 's') {
        return
      }
      e.preventDefault()
      if (e.isComposing || e.repeat) {
        return
      }
      onSaveRef.current()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [isActive])
}
