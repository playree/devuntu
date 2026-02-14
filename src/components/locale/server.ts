'use server'

import { safeAuthAction } from '@/lib/action'
import { errValidation } from '@/lib/error'
import { prisma } from '@/lib/prisma'
import { localeConfig } from '@/locale/config'
import { z } from 'zod'

export const setUserLocale = safeAuthAction
  .metadata({ actionName: 'setUserLocale', role: 'user' })
  .inputSchema(z.object({ locale: z.string() }))
  .action(async ({ parsedInput: { locale }, ctx: { user } }) => {
    if (!localeConfig.locales.includes(locale)) {
      throw errValidation('locale does not exist')
    }
    await prisma.user.update({ where: { id: user.id }, data: { locale } })
  })
