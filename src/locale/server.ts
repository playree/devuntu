import { envu } from '@/lib/env-util'
import { expandTemplate, pickFallbackLocale, type LocaleValues } from '@/lib/locale-util'
import { LocaleItem } from '.'
import { localeConfig } from './config'

export const defaultLocale = envu.server.DEFAULT_LOCALE || localeConfig.locales[0]
export const fallbackLocale = pickFallbackLocale(localeConfig, envu.server.DEFAULT_LOCALE)

export const t = (locale: string | null, item: LocaleItem, values?: LocaleValues) => {
  const { resources, locales } = localeConfig
  const lc = locale && locales.includes(locale) ? locale : defaultLocale

  const template = resources[lc][item] || resources[defaultLocale][item] || ''
  return expandTemplate(template, values)
}
