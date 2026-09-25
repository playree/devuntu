'use client'

import { cn } from '@heroui/react'
import { FC, ReactNode, useState } from 'react'
import { Bars3BottomLeftIcon } from './icons'

/**
 * サイドメニュー付きのレイアウト。
 * 配下に `data-nav-hidden` を持つ要素があると、lg 以上でもサイドメニューを左へ隠して
 * メインコンテンツを全幅にする(チケット詳細パネルのような広い表示用)。
 */
export const SideNavbar: FC<{
  children: ReactNode
  menu: (closeMenu?: () => void) => ReactNode
  className?: string
}> = ({ children, menu, className }) => {
  const [isOpen, setIsOpen] = useState(false)
  const closeMenu = () => {
    setIsOpen(false)
  }
  return (
    <div className='group/sidenav'>
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
          'bg-background fixed top-0 left-0 z-40 h-screen w-64 transition-transform',
          isOpen ? '' : '-translate-x-full lg:translate-x-0',
          /**
           * :has() を含むセレクタは lg:translate-x-0 より詳細度が高いので、記述順に関係なく隠れる。
           * lg 未満はメニューが元々オーバーレイなので、開いている最中に閉じてしまわないよう lg 限定にする
           */
          'lg:group-has-data-nav-hidden/sidenav:-translate-x-full',
        )}
      >
        <div className={cn('h-full overflow-y-auto px-3 py-4', className)}>
          {menu(() => {
            setTimeout(closeMenu, 200)
          })}
        </div>
      </nav>
      <div
        className={cn('fixed inset-0 z-30 bg-gray-900 opacity-50 dark:opacity-80', isOpen ? '' : 'hidden')}
        onClick={closeMenu}
      ></div>

      <div // メインコンテンツ
        id='side-main'
        className={cn(
          'p-4 transition-[margin] group-has-data-nav-hidden/sidenav:ml-0 lg:ml-64',
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
  )
}
