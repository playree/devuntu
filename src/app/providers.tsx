'use client'

import { HeroUIProvider } from '@heroui/react'
import { FC, ReactNode } from 'react'

export interface ProvidersProps {
  children: ReactNode
}

export const Providers: FC<ProvidersProps> = ({ children }) => {
  return <HeroUIProvider>{children}</HeroUIProvider>
}
