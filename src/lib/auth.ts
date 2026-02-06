import { APIError, betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'
import { admin, twoFactor } from 'better-auth/plugins'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { ulid } from 'ulid'
import { authConfig } from './auth-config'
import { envu, makeUrl } from './env-util'
import { logger } from './logger'
import { prisma } from './prisma'

export const auth = betterAuth({
  appName: envu.server.NEXT_PUBLIC_APP_NAME,
  baseURL: envu.server.NEXT_PUBLIC_URL,
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
  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          if (!ctx?.body?.password) {
            // Email & Password以外でのユーザー作成は許可しない
            throw new APIError('BAD_REQUEST', { code: 'USER_NOT_EXIST', message: 'user not exist' })
          }
        },
      },
    },
  },
  socialProviders: {
    ...(!!envu.server.GOOGLE_CLIENT_ID && !!envu.server.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: envu.server.GOOGLE_CLIENT_ID,
            clientSecret: envu.server.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
  },
  plugins: [
    admin(),
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
