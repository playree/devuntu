'use client'

import { cn } from '@heroui/react'
import { FC, ReactNode, SVGProps, useState } from 'react'

const Bars3BottomLeftIcon: FC<SVGProps<SVGSVGElement>> = ({ width = 20, strokeWidth = 2, ...props }) => (
  <svg
    fill='currentColor'
    viewBox='0 0 24 24'
    xmlns='http://www.w3.org/2000/svg'
    aria-hidden='true'
    width={width}
    strokeWidth={strokeWidth}
    {...props}
  >
    <path
      clipRule='evenodd'
      fillRule='evenodd'
      d='M3 6.75A.75.75 0 013.75 6h16.5a.75.75 0 010 1.5H3.75A.75.75 0 013 6.75zM3 12a.75.75 0 01.75-.75h16.5a.75.75
          0 010 1.5H3.75A.75.75 0 013 12zm0 5.25a.75.75 0 01.75-.75H12a.75.75 0 010 1.5H3.75a.75.75 0 01-.75-.75z'
    />
  </svg>
)

export const SideNavbar: FC<{
  children: ReactNode
  menu: (closeMenu?: () => void) => ReactNode
  pendding?: () => ReactNode | undefined | null
  className?: string
}> = ({ children, menu, pendding, className }) => {
  const [isOpen, setIsOpen] = useState(false)
  const closeMenu = () => {
    setIsOpen(false)
  }
  if (pendding) {
    const pd = pendding()
    if (pd) {
      return pd
    }
  }

  return (
    <>
      <button
        className={cn(
          'fixed z-40 mt-2 ml-3 rounded-lg bg-gray-200 p-2 text-sm text-gray-500',
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
          'fixed top-0 left-0 z-40 h-screen w-64 transition-transform',
          isOpen ? '' : '-translate-x-full lg:translate-x-0',
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
        className='p-4 lg:ml-64'
      >
        {children}
      </div>
    </>
  )
}
