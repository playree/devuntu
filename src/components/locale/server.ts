'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { errValidation } from '@/lib/error'
import { prisma } from '@/lib/prisma'
import { scSetUserLocale } from '@/lib/schema/schema-auth'
import { localeConfig } from '@/locale/config'

export const setUserLocale = safeAuthAction
  // サインイン画面のカードからも切り替えるため、2FA の設定前でも呼べる
  .metadata({ actionName: 'setUserLocale', role: 'user', allowWithoutTwoFa: true })
  .inputSchema(scSetUserLocale)
  .action(async ({ parsedInput: { locale }, ctx: { user } }) => {
    if (!localeConfig.locales.includes(locale)) {
      throw errValidation('locale does not exist')
    }
    await prisma.user.update({ where: { id: user.id }, data: { locale } })
  })
