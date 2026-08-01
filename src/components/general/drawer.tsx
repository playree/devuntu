'use client'

import { cn } from '@heroui/react'
import { AnimatePresence, motion } from 'framer-motion'
import { FC, ReactNode } from 'react'

/**
 * 画面右端から出てくるパネル。
 * スクリム(背景の覆い)は置かないため、開いている間も背後の要素を操作できる。
 * 見た目(背景色・境界線・余白)は className で指定する。
 */
export const SideDrawer: FC<{
  isOpen: boolean
  children: ReactNode
  className?: string
}> = ({ isOpen, children, className }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className={cn('fixed inset-y-0 right-0 z-30 w-full overflow-y-auto lg:w-4xl', className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
