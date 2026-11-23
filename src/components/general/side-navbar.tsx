'use client'

import { cn } from '@heroui/react'
import { CSSProperties, FC, ReactNode, useCallback, useRef, useState } from 'react'
import { setCookie } from './cookie/client'
import { Bars3BottomLeftIcon } from './icons'
import { SideNavResizer } from './side-nav-resizer'
import { SideNavProvider } from './side-nav-slot'
import {
  clampSideNavWidth,
  SIDE_NAV_WIDTH_COOKIE,
  SIDE_NAV_WIDTH_COOKIE_MAX_AGE,
  SIDE_NAV_WIDTH_DEFAULT,
} from './side-nav-width'

/**
 * サイドメニュー付きのレイアウト。
 * 配下に `data-nav-hidden` を持つ要素があると、lg 以上でもサイドメニューを左へ隠して
 * メインコンテンツを全幅にする(チケット詳細パネルのような広い表示用)。
 *
 * 幅は CSS 変数 `--side-nav-w` で持ち、lg 以上では右端のハンドルで変えられる(Cookie に保存)。
 * オーバーレイ表示(lg 未満)では画面を覆い切らないよう 85vw で頭打ちにする。
 * ページからメニューへ内容を差し込む口(`SideNavPortal`)は `side-nav-slot.tsx` を参照。
 */
export const SideNavbar: FC<{
  children: ReactNode
  menu: (closeMenu?: () => void) => ReactNode
  className?: string
  /** 初期の幅(px)。サーバーで Cookie から読んで渡すと、初回の描画から保存した幅で出る */
  defaultWidth?: number
}> = ({ children, menu, className, defaultWidth = SIDE_NAV_WIDTH_DEFAULT }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [width, setWidth] = useState(() => clampSideNavWidth(defaultWidth))
  const [isResizing, setIsResizing] = useState(false)

  const closeMenu = useCallback(() => {
    setTimeout(() => setIsOpen(false), 200)
  }, [])

  const rootRef = useRef<HTMLDivElement>(null)

  /** ドラッグ中は CSS 変数だけを書き換え、メニュー全体を描画し直さない */
  const previewWidth = (next: number) => {
    rootRef.current?.style.setProperty('--side-nav-w', `${next}px`)
  }

  const commitWidth = (next: number) => {
    setWidth(next)
    setCookie(SIDE_NAV_WIDTH_COOKIE, String(next), { maxAge: SIDE_NAV_WIDTH_COOKIE_MAX_AGE, path: '/' })
  }

  return (
    <SideNavProvider closeMenu={closeMenu}>
      <div
        ref={rootRef}
        className={cn('group/sidenav', isResizing && 'cursor-col-resize select-none')}
        style={{ '--side-nav-w': `${width}px` } as CSSProperties}
      >
        <button
          className={cn(
            'text-muted fixed z-40 mt-2 ml-3 rounded-lg bg-gray-200 p-2 text-sm',
            'opacity-50 hover:bg-gray-300 focus:ring-2 focus:ring-gray-200 focus:outline-hidden',
            'lg:hidden dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600',
          )}
          onClick={() => {
            setIsOpen(true)
          }}
        >
          <Bars3BottomLeftIcon width={18} />
        </button>

        <nav // サイドメニュー
          id='side-menu'
          className={cn(
            'bg-background fixed top-0 left-0 z-40 h-screen w-(--side-nav-w) max-w-[85vw] transition-transform lg:max-w-none',
            isOpen ? '' : '-translate-x-full lg:translate-x-0',
            /**
             * :has() を含むセレクタは lg:translate-x-0 より詳細度が高いので、記述順に関係なく隠れる。
             * lg 未満はメニューが元々オーバーレイなので、開いている最中に閉じてしまわないよう lg 限定にする
             */
            'lg:group-has-data-nav-hidden/sidenav:-translate-x-full',
          )}
        >
          <div className={cn('h-full overflow-y-auto px-3 py-4', className)}>{menu(closeMenu)}</div>
          <SideNavResizer
            width={width}
            onPreview={previewWidth}
            onCommit={commitWidth}
            onResizingChange={setIsResizing}
          />
        </nav>
        <div
          className={cn('fixed inset-0 z-30 bg-gray-900 opacity-50 dark:opacity-80', isOpen ? '' : 'hidden')}
          onClick={() => {
            setIsOpen(false)
          }}
        ></div>

        <div // メインコンテンツ
          id='side-main'
          className={cn(
            'p-4 transition-[margin] group-has-data-nav-hidden/sidenav:ml-0 lg:ml-(--side-nav-w)',
            // ドラッグ中に余白が遅れて付いてこないよう、アニメーションを止める
            isResizing && 'transition-none',
            /**
             * 子が data-fit-screen のページ(かんばんのように内部スクロールで 1 画面に収めるページ)は、
             * md 以上ではここが画面高を持ちきってページ側へ溢れを逃がさない。子は h-full / max-h-full で追従する。
             * ページ全体のスクロールを使う data-wide(幅だけの指定)とは別物なので属性を分けている。
             * md 未満は縦積みでページ全体のスクロールに任せるため掛けない(掛けると内容に届かなくなる)。
             */
            'md:has-data-fit-screen:h-screen md:has-data-fit-screen:overflow-hidden',
          )}
        >
          {children}
        </div>
      </div>
    </SideNavProvider>
  )
}
