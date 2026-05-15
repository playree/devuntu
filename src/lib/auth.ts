import { oauthProvider } from '@better-auth/oauth-provider'
import { passkey } from '@better-auth/passkey'
import { APIError, betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'
import { admin, genericOAuth, type GenericOAuthConfig, jwt, twoFactor } from 'better-auth/plugins'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { uuidv7 } from 'uuidv7'
import { authConfig } from './auth-config'
import { envu, makeUrl } from './env-util'
import { logger } from './logger'
import { sendEmailOtp } from './mail'
import { prisma } from './prisma'

const oauthConfigs: GenericOAuthConfig[] = []
if (
  !!envu.server.MAIN_DEVUNTU_URL &&
  !!envu.server.MAIN_DEVUNTU_CLIENT_ID &&
  !!envu.server.MAIN_DEVUNTU_CLIENT_SECRET
) {
  oauthConfigs.push({
    providerId: 'devuntu',
    clientId: envu.server.MAIN_DEVUNTU_CLIENT_ID,
    clientSecret: envu.server.MAIN_DEVUNTU_CLIENT_SECRET,
    discoveryUrl: new URL('.well-known/openid-configuration', envu.server.MAIN_DEVUNTU_URL).toString(),
  })
}

export const auth = betterAuth({
  appName: envu.server.NEXT_PUBLIC_APP_NAME,
  baseURL: envu.server.NEXT_PUBLIC_URL,
  database: prismaAdapter(prisma, {
    provider: 'sqlite',
  }),
  advanced: {
    database: {
      generateId: () => uuidv7(),
    },
  },
  logger: {
    level: 'warn',
    log: (level, message, ...args) => logger['warn'](message, ...args),
  },
  user: {
    additionalFields: {
      locale: {
        type: 'string',
        required: false,
      },
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
            // Email & Password以外でのユーザー作成
            const provider = ctx?.params?.id
            logger.debug({ provider }, 'databaseHooks.user.create.before')

            // 基本的に許可しない
            throw new APIError('BAD_REQUEST', { code: 'USER_NOT_EXIST', message: 'user not exist' })
          }
        },
      },
      update: {
        after: async (user) => {
          logger.debug({ user }, 'update')
          if (!user.emailVerified && user.twoFactorEnabled) {
            // 2FA完了後にemailVerifiedを更新
            await prisma.user.update({
              where: { id: user.id },
              data: { emailVerified: true },
            })
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
            overrideUserInfoOnSignIn: true,
          },
        }
      : {}),
  },
  plugins: [
    admin(),
    nextCookies(),
    twoFactor({
      // skipVerificationOnEnable: true,
      otpOptions: {
        sendOTP: async ({ user: { locale = '', email }, otp }) => {
          await sendEmailOtp({ locale, to: email, otp })
        },
      },
    }),
    passkey({
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'required',
      },
    }),
    jwt(),
    oauthProvider({
      loginPage: authConfig.path.signIn,
      consentPage: '/consent',
      silenceWarnings: { oauthAuthServerConfig: true }, // 暫定
    }),
    genericOAuth({
      config: oauthConfigs,
    }),
  ],
})

export const getServerSession = async () =>
  auth.api.getSession({
    headers: await headers(),
  })

export const redirectSignIn = (callbackURL?: string) =>
  NextResponse.redirect(makeUrl(authConfig.path.signIn, callbackURL ? { cb: callbackURL } : undefined))

export const redirectTwoFaEnable = (callbackURL?: string) =>
  NextResponse.redirect(makeUrl(authConfig.path.signIn, callbackURL ? { cb: callbackURL, mode: '2FA' } : undefined))
