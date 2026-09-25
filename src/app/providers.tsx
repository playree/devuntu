'use client'

import { ActionErrorNotifier } from '@/components/action-error-notifier'
import { ConfirmModalProvider } from '@/components/general/modal'
import { GeneralUiText, GeneralUiTextProvider } from '@/components/general/ui-text'
import { LocaleProvider } from '@/components/locale/client'
import { NotifyProvider } from '@/components/notify'
import { useLocale } from '@/locale/client'
import { localeConfig } from '@/locale/config'
import { RouterProvider } from '@heroui/react'
import { ThemeProvider, type ThemeProviderProps } from 'next-themes'
import { useRouter } from 'next/navigation'
import { FC, ReactNode, useMemo } from 'react'

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

/** general 配下の部品が内部で出す文言をロケールから注入する */
const MyGeneralUiTextProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const { t } = useLocale()
  const uiText = useMemo<GeneralUiText>(
    () => ({
      ok: t('ok'),
      cancel: t('cancel'),
      confirmed: t('confirmed'),
      copy: t('copy'),
      copied: t('copied'),
      show: t('show'),
      hide: t('hide'),
      clear: t('clear'),
      search: t('search'),
      notSelected: t('not_selected'),
      on: t('state_on'),
      off: t('state_off'),
      themeSelect: t('theme_select'),
      themeSystem: t('theme_system'),
      themeLight: t('theme_light'),
      themeDark: t('theme_dark'),
      prev: t('prev'),
      next: t('next'),
      rowsPerPage: t('rows_per_page'),
      perPage: (rows) => t('per_page', { rows }),
      noResults: t('results_none'),
      tableEmpty: t('table_empty'),
      resultRange: (start, end, total) => t('results_range', { start, end, total }),
      waitSeconds: (sec) => t('wait_seconds', { sec }),
    }),
    [t],
  )

  return <GeneralUiTextProvider uiText={uiText}>{children}</GeneralUiTextProvider>
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
        <MyGeneralUiTextProvider>
          <ConfirmModalProvider>
            <ActionErrorNotifier />
            <MyRouterProvider>{children}</MyRouterProvider>
          </ConfirmModalProvider>
        </MyGeneralUiTextProvider>
      </LocaleProvider>
    </ThemeProvider>
  )
}
