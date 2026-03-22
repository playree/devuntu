'use client'

import { motion } from 'framer-motion'
import { FC, ReactNode } from 'react'

const variantsStep = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
    position: 'absolute' as const,
  }),
  center: {
    x: 0,
    opacity: 1,
    position: 'relative' as const,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -80 : 80,
    opacity: 0,
    position: 'absolute' as const,
  }),
}

export const StepMotion: FC<{
  children: ReactNode
  direction: number
  className?: string
}> = ({ children, direction, className }) => {
  return (
    <motion.div
      custom={direction}
      variants={variantsStep}
      initial={direction === 0 ? false : 'enter'}
      animate='center'
      exit='exit'
      transition={{ duration: 0.5, ease: 'easeInOut' }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
