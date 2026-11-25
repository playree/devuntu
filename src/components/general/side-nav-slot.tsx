'use client'

import { createContext, FC, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * ページからサイドメニューへ内容を差し込む口。
 *
 * サイドメニューはページより上のレイアウトで描画されるので、ページ側の context(ツリーの再取得など)は届かない。
 * ページ側は `SideNavPortal` で内容をポータルとして描き、メニュー側は `SideNavSlot` で差し込み先を置く。
 * 差し込みがあるかどうか(`hasContent`)と、その見出し(`contentLabel`)でメニュー側が表示を切り替える。
 */
type SideNavContextValue = {
  slot: HTMLElement | null
  setSlot: (slot: HTMLElement | null) => void
  hasContent: boolean
  contentLabel: string | null
  register: (label: string) => () => void
  /** スマホ幅のオーバーレイを閉じる(lg 以上では何もしない) */
  closeMenu: () => void
}

const SideNavContext = createContext<SideNavContextValue | null>(null)

let nextEntryId = 0

export const SideNavProvider: FC<{ closeMenu: () => void; children: ReactNode }> = ({ closeMenu, children }) => {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  // 同時に複数の差し込みは想定しないが、遷移で外す前に次が付く順序でも消えないよう最後に付いたものを使う
  const [entries, setEntries] = useState<{ id: number; label: string }[]>([])

  const register = useCallback((label: string) => {
    const id = ++nextEntryId
    setEntries((prev) => [...prev, { id, label }])
    return () => setEntries((prev) => prev.filter((entry) => entry.id !== id))
  }, [])

  const value = useMemo<SideNavContextValue>(
    () => ({
      slot,
      setSlot,
      hasContent: entries.length > 0,
      contentLabel: entries.at(-1)?.label ?? null,
      register,
      closeMenu,
    }),
    [slot, entries, register, closeMenu],
  )
  return <SideNavContext.Provider value={value}>{children}</SideNavContext.Provider>
}

/** メニュー側に置く差し込み先 */
export const SideNavSlot: FC<{ className?: string }> = ({ className }) => {
  const setSlot = useContext(SideNavContext)?.setSlot
  return <div ref={setSlot} className={className} />
}

/** ページ側で使う。マウントしている間だけメニューに差し込む */
export const SideNavPortal: FC<{
  /** メニュー側のタブなどに出す見出し。変わるたびに付け直すので文字列に限る */
  label: string
  children: ReactNode
}> = ({ label, children }) => {
  const context = useContext(SideNavContext)
  const register = context?.register
  useEffect(() => register?.(label), [register, label])
  return context?.slot ? createPortal(children, context.slot) : null
}

const noop = () => {}

export const useSideNav = () => {
  const context = useContext(SideNavContext)
  return {
    hasContent: context?.hasContent ?? false,
    contentLabel: context?.contentLabel ?? null,
    closeMenu: context?.closeMenu ?? noop,
  }
}
