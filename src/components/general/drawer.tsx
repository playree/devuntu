'use client'

import { cn } from '@heroui/react'
import { AnimatePresence, motion } from 'framer-motion'
import { FC, ReactNode, useEffect, useRef } from 'react'

/**
 * 画面右端から出てくるパネル。
 * スクリム(背景の覆い)は置かないため、開いている間も背後の要素を操作できる。
 * 見た目(背景色・境界線・余白)は className で指定する。
 *
 * スクリムが無くフォーカストラップも張らない(背後を操作できることが要件)ため、
 * `role='dialog'` + `aria-label` でランドマークとして識別できるようにし、
 * 開いた直後にパネル自身へフォーカスを移してキーボード操作の起点を中に入れる。
 */
export const SideDrawer: FC<{
  isOpen: boolean
  children: ReactNode
  /** 読み上げ用のパネル名。共通部品なのでロケールは呼び出し側で解決する */
  ariaLabel?: string
  /** 指定すると開いている間だけ Escape で閉じられるようになる */
  onClose?: () => void
  className?: string
}> = ({ isOpen, children, ariaLabel, onClose, className }) => {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }
    // 行選択で開く場合、react-aria の Table が同じターンでセルへフォーカスを戻すため、
    // 次フレームまで待ってから移す(同期的に focus すると後勝ちで奪われる)
    const id = requestAnimationFrame(() => panelRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [isOpen])

  // モーダルやポップオーバーが処理済みの Escape(defaultPrevented)と、
  // 入力中の Escape は入力内容を失わせないため無視する。
  useEffect(() => {
    if (!isOpen || !onClose) {
      return
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) {
        return
      }
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, [contenteditable="true"]')) {
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={panelRef}
          role='dialog'
          aria-label={ariaLabel}
          // プログラムからフォーカスするためだけの tabIndex(Tab 順には入れない)
          tabIndex={-1}
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className={cn('fixed inset-y-0 right-0 z-30 w-full overflow-y-auto outline-none lg:w-4xl', className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
