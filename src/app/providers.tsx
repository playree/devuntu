'use client'

import { ConfirmModalProvider } from '@/components/general/modal'
import { LocaleProvider } from '@/components/locale/client'
import { NotifyProvider } from '@/components/notify'
import { useLocale } from '@/locale/client'
import { localeConfig } from '@/locale/config'
import { RouterProvider } from '@heroui/react'
import { ThemeProvider, type ThemeProviderProps } from 'next-themes'
import { useRouter } from 'next/navigation'
import { FC, ReactNode } from 'react'

export interface ProvidersProps {
  children: ReactNode
  themeProps?: ThemeProviderProps
  defaultLocale: string
  acceptLanguage: string | null
  cookieLocale: string | null
}

/** HeroUI(react-aria)の href を Next.js のクライアント遷移に繋ぐ */
const MyRouterProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const router = useRouter()

  return (
    <RouterProvider navigate={(href, routerOptions) => router.push(href, routerOptions)}>{children}</RouterProvider>
  )
}

const MyConfirmModalProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const { t } = useLocale()

  return (
    <ConfirmModalProvider uiText={{ ok: t('ok'), cancel: t('cancel'), confirmed: t('confirmed') }}>
      {children}
    </ConfirmModalProvider>
  )
}

export const Providers: FC<ProvidersProps> = ({
  children,
  themeProps,
  defaultLocale,
  acceptLanguage,
  cookieLocale,
}) => {
  return (
    <ThemeProvider {...themeProps}>
      <NotifyProvider />
      <LocaleProvider
        config={localeConfig}
        defaultLocale={defaultLocale}
        acceptLanguage={acceptLanguage}
        cookieLocale={cookieLocale}
      >
        <MyConfirmModalProvider>
          <MyRouterProvider>{children}</MyRouterProvider>
        </MyConfirmModalProvider>
      </LocaleProvider>
    </ThemeProvider>
  )
}
