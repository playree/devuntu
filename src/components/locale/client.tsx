'use client'

import { expandTemplate, pickLocale, type LocaleConfig, type LocaleValues } from '@/lib/locale-util'
import { FC, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { getCookie } from '../general/cookie/client'

type LocaleContextType = {
  locale: string
  lcConfig: LocaleConfig
  defaultLocale: string
  setLocale: (locale: string) => void
  t: (item: string, values?: LocaleValues) => string
}

const LocaleContext = createContext<LocaleContextType>({} as LocaleContextType)

const useLocaleContext = (
  localeConfig: LocaleConfig,
  defaultLocale: string,
  fallbackLocale: string,
  acceptLanguage: string | null,
  cookieLocale: string | null,
): LocaleContextType => {
  const [locale, setLocale] = useState(() => pickLocale(localeConfig, fallbackLocale, acceptLanguage, cookieLocale))
  const lcConfig = useMemo(() => localeConfig, [localeConfig])

  useEffect(() => {
    // proxy が同一レスポンスで発行した Cookie など、サーバー側で読めなかった指定を描画後に反映する
    const current = pickLocale(lcConfig, fallbackLocale, acceptLanguage, getCookie(lcConfig.cookie.name) ?? null)
    if (current !== locale) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocale(current)
    }
  }, [acceptLanguage, fallbackLocale, lcConfig, locale])

  return {
    locale,
    lcConfig: lcConfig,
    defaultLocale,
    setLocale: useCallback((current: string) => {
      setLocale(current)
    }, []),
    t: useCallback(
      (item, values) => {
        const { resources } = lcConfig
        const lc = resources[locale] ? locale : defaultLocale

        const template = resources[lc][item] || resources[defaultLocale][item] || ''
        return expandTemplate(template, values)
      },
      [defaultLocale, locale, lcConfig],
    ),
  }
}

export const LocaleProvider: FC<{
  children: React.ReactNode
  config: LocaleConfig
  defaultLocale: string
  /** ブラウザの言語がどのロケールにも一致しないときの表示ロケール */
  fallbackLocale: string
  acceptLanguage: string | null
  /** サーバー側で読み取ったロケール Cookie。SSR の出力をクライアントの初期描画と揃えるために受け取る */
  cookieLocale: string | null
}> = ({ children, config, defaultLocale, fallbackLocale, acceptLanguage, cookieLocale }) => {
  const ctx = useLocaleContext(config, defaultLocale, fallbackLocale, acceptLanguage, cookieLocale)

  return <LocaleContext.Provider value={ctx}>{children}</LocaleContext.Provider>
}

export const useLocale = <T extends string = string>() => {
  const { t, ...context } = useContext(LocaleContext)
  return {
    ...context,
    t: t as (item: T, values?: LocaleValues) => string,
  }
}
