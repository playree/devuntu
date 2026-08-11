import { LocaleConfig } from '@/lib/locale-util'
import { en } from './lang-en'
import { ja } from './lang-ja'

export const localeConfig: LocaleConfig = {
  locales: ['ja', 'en'],
  resources: { ja, en },
  cookie: {
    name: 'locale',
    maxAge: 86400 * 365,
  },
}
