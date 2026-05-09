'use client'

import { LogoSVG } from '@/components/logo'
import { FC } from 'react'

export const HomeClient: FC = () => {
  return (
    <div className='flex items-center justify-center'>
      <LogoSVG width={240} className='mt-8' />
    </div>
  )
}
