'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { errValidation } from '@/lib/error'
import { prisma } from '@/lib/prisma'
import { scSetUserLocale } from '@/lib/schema/schema-auth'
import { localeConfig } from '@/locale/config'

export const setUserLocale = safeAuthAction
  .metadata({ actionName: 'setUserLocale', role: 'user' })
  .inputSchema(scSetUserLocale)
  .action(async ({ parsedInput: { locale }, ctx: { user } }) => {
    if (!localeConfig.locales.includes(locale)) {
      throw errValidation('locale does not exist')
    }
    await prisma.user.update({ where: { id: user.id }, data: { locale } })
  })
