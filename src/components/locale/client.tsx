'use client'

import acceptLanguageParser from 'accept-language-parser'
import { FC, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { getCookie } from '../general/cookie/client'
import { expandTemplate, type LocaleValues } from './template'
import { LocaleConfig } from './types'

type LocaleContextType = {
  locale: string
  lcConfig: LocaleConfig
  defaultLocale: string
  setLocale: (locale: string) => void
  t: (item: string, values?: LocaleValues) => string
}

const LocaleContext = createContext<LocaleContextType>({} as LocaleContextType)

/**
 * 表示するロケールを決める。Cookie の指定が最優先で、無ければ Accept-Language から選ぶ。
 *
 * Cookie は SSR では読めないので値を引数で受け取る。サーバーとクライアントで同じ入力を渡せば
 * 同じ結果になるため、初期描画をサーバー側と一致させられる。
 */
const pickLocale = (
  localeConfig: LocaleConfig,
  defaultLocale: string,
  acceptLanguage: string | null,
  cookieLocale: string | null,
) => {
  if (cookieLocale && localeConfig.locales.includes(cookieLocale)) {
    return cookieLocale
  }

  return (
    acceptLanguageParser.pick(localeConfig.locales, acceptLanguage ?? defaultLocale, { loose: true }) || defaultLocale
  )
}

const useLocaleContext = (
  localeConfig: LocaleConfig,
  defaultLocale: string,
  acceptLanguage: string | null,
  cookieLocale: string | null,
): LocaleContextType => {
  const [locale, setLocale] = useState(() => pickLocale(localeConfig, defaultLocale, acceptLanguage, cookieLocale))
  const lcConfig = useMemo(() => localeConfig, [localeConfig])

  useEffect(() => {
    // proxy が同一レスポンスで発行した Cookie など、サーバー側で読めなかった指定を描画後に反映する
    const current = pickLocale(lcConfig, defaultLocale, acceptLanguage, getCookie(lcConfig.cookie.name) ?? null)
    if (current !== locale) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocale(current)
    }
  }, [acceptLanguage, defaultLocale, lcConfig, locale])

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
  acceptLanguage: string | null
  /** サーバー側で読み取ったロケール Cookie。SSR の出力をクライアントの初期描画と揃えるために受け取る */
  cookieLocale: string | null
}> = ({ children, config, defaultLocale, acceptLanguage, cookieLocale }) => {
  const ctx = useLocaleContext(config, defaultLocale, acceptLanguage, cookieLocale)

  return <LocaleContext.Provider value={ctx}>{children}</LocaleContext.Provider>
}

export const useLocale = <T extends string = string>() => {
  const { t, ...context } = useContext(LocaleContext)
  return {
    ...context,
    t: t as (item: T, values?: LocaleValues) => string,
  }
}
