'use client'

import { motion } from 'framer-motion'
import { FC, ReactNode, useState } from 'react'

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
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/**
 * StepMotion で切り替えるステップの状態。direction は StepMotion にそのまま渡す
 * (0 = 初期表示でアニメーションしない / 1 = 進む / -1 = 戻る)
 */
export const useStep = <T extends string>(initial: T) => {
  const [step, setStep] = useState<{ id: T; direction: number }>({ id: initial, direction: 0 })
  return {
    step,
    forward: (id: T) => setStep({ id, direction: 1 }),
    back: (id: T) => setStep({ id, direction: -1 }),
  }
}
