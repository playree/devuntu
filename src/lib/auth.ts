import { oauthProvider } from '@better-auth/oauth-provider'
import { passkey } from '@better-auth/passkey'
import { APIError, betterAuth, GoogleProfile } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'
import { admin, emailOTP, genericOAuth, type GenericOAuthConfig, jwt, twoFactor } from 'better-auth/plugins'
import { decodeJwt } from 'jose'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { uuidv7 } from 'uuidv7'
import { authConfig } from './auth-config'
import { nowDate } from './day'
import { envu } from './env-util'
import { CALENDAR_READONLY_SCOPE, GOOGLE_ACCOUNT_PROVIDER_ID } from './google-calendar'
import { logger } from './logger'
import { sendEmailOtp } from './mail'
import { prisma } from './prisma'
import { makeUrl } from './server-utils'

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
    scopes: ['openid', 'profile', 'email'],
    overrideUserInfo: true,
    pkce: true,
    mapProfileToUser: async (profile) => {
      logger.debug({ profile }, 'provider.devuntu')
      return {}
    },
  })
}

// カレンダー連携用の Google プロバイダ(ログイン用 'google' とは分離)
// refresh token を確実に得るため access_type=offline + prompt=consent を指定
if (!!envu.server.GOOGLE_CLIENT_ID && !!envu.server.GOOGLE_CLIENT_SECRET) {
  oauthConfigs.push({
    providerId: GOOGLE_ACCOUNT_PROVIDER_ID,
    clientId: envu.server.GOOGLE_CLIENT_ID,
    clientSecret: envu.server.GOOGLE_CLIENT_SECRET,
    discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
    // 'profile' は必須。無いと userinfo に name が返らず better-auth が name_is_missing で失敗する
    scopes: ['openid', 'profile', 'email', CALENDAR_READONLY_SCOPE],
    pkce: true,
    accessType: 'offline',
    prompt: 'consent',
    disableSignUp: true,
  })
}

export const auth = betterAuth({
  appName: envu.server.NEXT_PUBLIC_APP_NAME,
  session: {
    expiresIn: envu.server.SESSION_EXPIRES_IN,
    freshAge: envu.server.SESSION_FRESH_AGE,
  },
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
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
        input: false,
      },
      timezone: {
        type: 'string',
        required: false,
        input: false,
      },
      lastLoginAt: {
        type: 'date',
        required: false,
        input: false,
      },
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['google'],
    },
  },
  emailAndPassword: {
    enabled: !envu.server.DISABLE_PASSWORD_AUTH,
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          const path = ctx?.path
          const provider = ctx?.params?.id
          logger.debug({ path, provider }, 'databaseHooks.user.create.before')

          if (path !== '/admin/create-user') {
            // ユーザーの自動作成

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
    session: {
      create: {
        after: async (session) => {
          await prisma.user.update({
            where: { id: session.userId },
            data: { lastLoginAt: nowDate() },
          })
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
            // ログイン用途。毎回の同意画面を避けるため consent は付けない
            // (refresh token が必要なカレンダー連携は 'google-account' プロバイダで別途取得)
            getUserInfo: async (token) => {
              if (!token.idToken) {
                return null
              }
              const user = decodeJwt(token.idToken) as GoogleProfile

              // ドメインチェック
              const domain = user.email?.split('@')[1]
              if (!user.email_verified || !domain || !envu.server.GOOGLE_ALLOWED_DOMAINS.includes(domain)) {
                return null
              }

              return {
                user: {
                  id: user.sub,
                  name: user.name,
                  email: user.email,
                  image: user.picture,
                  emailVerified: user.email_verified,
                },
                data: user,
              }
            },
          },
        }
      : {}),
  },
  plugins: [
    admin(),
    emailOTP({
      disableSignUp: true,
      sendVerificationOTP: async ({ email, otp, type }) => {
        const user = await prisma.user.findUnique({ where: { email }, select: { locale: true } })
        logger.debug({ email, type, user }, 'sendVerificationOTP')
        if (user) {
          await sendEmailOtp({ locale: user.locale, to: email, otp })
        }
      },
    }),
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
    nextCookies(),
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
