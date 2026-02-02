import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'
import { twoFactor } from 'better-auth/plugins'
import { ulid } from 'ulid'
import { envu } from './env-util'
import { logger } from './logger'
import { prisma } from './prisma'

export const auth = betterAuth({
  appName: envu.server.NEXT_PUBLIC_APP_NAME,
  database: prismaAdapter(prisma, {
    provider: 'sqlite',
  }),
  advanced: {
    database: {
      generateId: () => ulid(),
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    nextCookies(),
    twoFactor({
      otpOptions: {
        sendOTP: async ({ user, otp }) => {
          logger.info({ user, otp }, 'sendOTP')
        },
      },
    }),
  ],
})
