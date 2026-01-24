'use client'

import { HeroUIProvider } from '@heroui/react'
import { ThemeProvider, type ThemeProviderProps } from 'next-themes'
import { FC, ReactNode } from 'react'

export interface ProvidersProps {
  children: ReactNode
  themeProps?: ThemeProviderProps
}

export const Providers: FC<ProvidersProps> = ({ children, themeProps }) => {
  return (
    <HeroUIProvider>
      <ThemeProvider {...themeProps}>{children}</ThemeProvider>
    </HeroUIProvider>
  )
}
