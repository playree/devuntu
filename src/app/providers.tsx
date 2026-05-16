'use client'

import { ConfirmModalProvider } from '@/components/general/modal'
import { LocaleProvider } from '@/components/locale/client'
import { NotifyProvider } from '@/components/notify'
import { useLocale } from '@/locale/client'
import { localeConfig } from '@/locale/config'
import { ThemeProvider, type ThemeProviderProps } from 'next-themes'
import { FC, ReactNode } from 'react'

export interface ProvidersProps {
  children: ReactNode
  themeProps?: ThemeProviderProps
  defaultLocale: string
  acceptLanguage: string | null
}

const MyConfirmModalProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const { t } = useLocale()

  return (
    <ConfirmModalProvider uiText={{ ok: t('ok'), cancel: t('cancel'), confirmed: t('confirmed') }}>
      {children}
    </ConfirmModalProvider>
  )
}

export const Providers: FC<ProvidersProps> = ({ children, themeProps, defaultLocale, acceptLanguage }) => {
  return (
    <ThemeProvider {...themeProps}>
      <NotifyProvider />
      <LocaleProvider config={localeConfig} defaultLocale={defaultLocale} acceptLanguage={acceptLanguage}>
        <MyConfirmModalProvider>{children}</MyConfirmModalProvider>
      </LocaleProvider>
    </ThemeProvider>
  )
}
