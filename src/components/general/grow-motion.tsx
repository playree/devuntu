'use client'

import { motion } from 'framer-motion'
import { FC, ReactNode } from 'react'

export const GrowMotion: FC<{
  children: ReactNode
  className?: string
}> = ({ children, className }) => {
  return (
    <div style={{ overflow: 'hidden' }}>
      <motion.div
        initial={{ y: '100%' }}
        whileInView={{ y: 0 }}
        transition={{
          type: 'spring',
          damping: 8,
          stiffness: 100,
          duration: 0.8,
        }}
        viewport={{ once: true }}
        style={{ margin: 0 }}
        className={className}
      >
        {children}
      </motion.div>
    </div>
  )
}
