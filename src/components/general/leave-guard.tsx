'use client'

import { useRouter } from 'next/navigation'
import { createContext, FC, ReactNode, useCallback, useContext, useEffect, useMemo, useRef } from 'react'

type ConfirmLeave = () => Promise<boolean>

type LeaveGuardContextValue = {
  setGuard: (confirm: ConfirmLeave | undefined) => void
  pushIfLeavable: (href: string) => Promise<void>
}

const LeaveGuardContext = createContext<LeaveGuardContextValue | null>(null)

/** 画面を離れる前の確認(useLeaveGuard)を、router.push で移る部品(メニューなど)と共有する */
export const LeaveGuardProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const router = useRouter()
  // 登録・解除で利用者を描き直さないよう、ref に持つ
  const guard = useRef<ConfirmLeave>(undefined)
  const setGuard = useCallback((confirm: ConfirmLeave | undefined) => {
    guard.current = confirm
  }, [])
  const pushIfLeavable = useCallback(
    async (href: string) => {
      if (!guard.current || (await guard.current())) {
        router.push(href)
      }
    },
    [router],
  )
  const value = useMemo(() => ({ setGuard, pushIfLeavable }), [setGuard, pushIfLeavable])
  return <LeaveGuardContext.Provider value={value}>{children}</LeaveGuardContext.Provider>
}

/**
 * router.push の代わりに使う。useLeaveGuard が有効なら確認を通してから移る。
 * Provider の外では確認せずに移る
 */
export const usePushIfLeavable = () => {
  const router = useRouter()
  const context = useContext(LeaveGuardContext)
  const push = useCallback((href: string) => Promise.resolve(router.push(href)), [router])
  return context?.pushIfLeavable ?? push
}

/**
 * クリックで画面を移るリンクの行き先(同一オリジン)。
 * 新しいタブ・ダウンロード・修飾キー付き・同じ画面内のアンカーは、今の画面が残るので対象外。
 * 別オリジンへのリンクはページ全体の読み込みになり、beforeunload で止まる
 */
const internalHrefOf = (e: MouseEvent) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
    return undefined
  }
  const anchor = e.target instanceof Element ? e.target.closest('a[href]') : null
  if (!(anchor instanceof HTMLAnchorElement)) {
    return undefined
  }
  if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) {
    return undefined
  }
  const url = new URL(anchor.href)
  if (url.origin !== location.origin) {
    return undefined
  }
  if (url.pathname === location.pathname && url.search === location.search) {
    return undefined
  }
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * 有効な間、画面を離れる前に確認する(未保存の下書きを守る)。
 * - タブを閉じる・再読み込み・別サイトへの移動: ブラウザの離脱警告(beforeunload)
 * - 画面内のリンク: クリックを捕捉(capture)して Next の Link や RouterProvider より先に止め、`confirmLeave` が true なら移る
 * - router.push で移る部品: usePushIfLeavable を通したものは同じ確認を通る
 *
 * ブラウザの戻る/進むは止められない
 */
export const useLeaveGuard = ({ isActive, confirmLeave }: { isActive: boolean; confirmLeave: ConfirmLeave }) => {
  const router = useRouter()
  const setGuard = useContext(LeaveGuardContext)?.setGuard
  // リスナーを張り直さずに最新の確認処理を使う
  const confirmRef = useRef(confirmLeave)
  useEffect(() => {
    confirmRef.current = confirmLeave
  })

  useEffect(() => {
    if (!isActive) {
      return
    }
    const confirm = () => confirmRef.current()
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // 古いブラウザは returnValue が設定されていないと警告を出さない
      e.returnValue = ''
    }
    const onClick = (e: MouseEvent) => {
      const href = internalHrefOf(e)
      if (href === undefined) {
        return
      }
      e.preventDefault()
      e.stopPropagation()
      void confirm().then((ok) => {
        if (ok) {
          router.push(href)
        }
      })
    }
    setGuard?.(confirm)
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      setGuard?.(undefined)
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [isActive, router, setGuard])
}
