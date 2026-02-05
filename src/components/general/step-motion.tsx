'use client'

import { motion } from 'framer-motion'
import { FC, ReactNode } from 'react'

export const StepMotion: FC<{
  children: ReactNode
  direction: number
  visible: boolean
}> = ({ children, direction, visible }) => {
  const variantsStep = {
    enter: (direction: number) => ({
      x: direction > 0 ? 80 : -80,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      x: direction > 0 ? -80 : 80,
      opacity: 0,
    }),
  }

  if (!visible) {
    return <></>
  }

  return (
    <motion.div
      custom={direction}
      variants={variantsStep}
      initial='enter'
      animate='center'
      exit='exit'
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      className='w-full space-y-4'
    >
      {children}
    </motion.div>
  )
}
