import { envu } from '@/lib/env-util'
import { LocaleItem } from '.'
import { localeConfig } from './config'

export const defaultLocale = envu.server.DEFAULT_LOCALE || localeConfig.locales[0]

export const t = (
  locale: string | null,
  item: LocaleItem,
  values?: { [key: string]: string | number | null | undefined },
) => {
  const { resources, locales } = localeConfig
  const lc = locale && locales.includes(locale) ? locale : defaultLocale

  const template = resources[lc][item] || resources[defaultLocale][item] || ''
  return !values
    ? template
    : new Function(...Object.keys(values), `return \`${template}\`;`)(
        ...Object.values(values).map((value) => value ?? ''),
      )
}
