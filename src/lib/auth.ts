import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'
import { twoFactor } from 'better-auth/plugins'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { ulid } from 'ulid'
import { authConfig } from './auth-config'
import { envu, makeUrl } from './env-util'
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

export const getServerSession = async () =>
  auth.api.getSession({
    headers: await headers(),
  })

export const redirectSignIn = (callbackURL?: string) =>
  NextResponse.redirect(makeUrl(authConfig.path.signIn, callbackURL ? { cb: callbackURL } : undefined))
