'use client'

import { LocaleProvider } from '@/components/locale/client'
import { localeConfig } from '@/locale/config'
import { HeroUIProvider, ToastProvider } from '@heroui/react'
import { ThemeProvider, type ThemeProviderProps } from 'next-themes'
import { FC, ReactNode } from 'react'

export interface ProvidersProps {
  children: ReactNode
  themeProps?: ThemeProviderProps
  defaultLocale: string
  acceptLanguage: string | null
}

export const Providers: FC<ProvidersProps> = ({ children, themeProps, defaultLocale, acceptLanguage }) => {
  return (
    <HeroUIProvider>
      <ThemeProvider {...themeProps}>
        <ToastProvider placement='top-center' />
        <LocaleProvider config={localeConfig} defaultLocale={defaultLocale} acceptLanguage={acceptLanguage}>
          {children}
        </LocaleProvider>
      </ThemeProvider>
    </HeroUIProvider>
  )
}
