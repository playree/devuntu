import { oauthProvider } from '@better-auth/oauth-provider'
import { passkey } from '@better-auth/passkey'
import { APIError, betterAuth, type BetterAuthPlugin, GoogleProfile } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { createAuthMiddleware } from 'better-auth/api'
import { nextCookies } from 'better-auth/next-js'
import { admin, emailOTP, genericOAuth, type GenericOAuthConfig, jwt, slack, twoFactor } from 'better-auth/plugins'
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
import { isLocalRegistration } from './oauth-registration'
import { idTokenStandardClaims } from './oidc-claims'
import { prisma } from './prisma'
import { makeUrl } from './server-utils'
import { SLACK_PROVIDER_ID } from './slack'
import { slackUserInfo } from './slack-server'

// oauthProvider(自身がOIDCプロバイダとして提供)用のスコープ(OIDCログイン用)
export const OIDC_PROVIDER_SCOPES = ['openid', 'profile', 'email'] as const

/** MCP サーバーへのアクセスを表すスコープ。同意画面で何を許可するのかを利用者に見せるために分けてある */
export const MCP_SCOPE = 'mcp'

/**
 * 動的登録されたクライアント(= MCP クライアント)に与えるスコープ。
 * 長時間の接続で refresh token を使うため offline_access を含む。
 */
export const MCP_SCOPES = [...OIDC_PROVIDER_SCOPES, 'offline_access', MCP_SCOPE] as const

/**
 * MCP サーバーのリソース識別子(RFC 8707 の `resource`)。
 *
 * クライアントがこの値を要求したときだけアクセストークンが JWT(RFC 9068)になり `aud` が載る。
 * `/.well-known/oauth-protected-resource/api/mcp` が返す `resource` と必ず同じ値にすること。
 */
export const MCP_RESOURCE = makeUrl('/api/mcp').toString()

/**
 * 動的クライアント登録(RFC 7591)の受け入れポリシー。
 *
 * `POST /oauth2/register` は未認証で叩ける。ここでリダイレクトURIをローカルに閉じたものだけに絞り、
 * 併せて `application_type` を native に倒す(未指定だと web 扱いになり、ループバックのURIが
 * `invalid_redirect_uri` で弾かれてしまう)。
 */
const dcrPolicy = {
  id: 'dcr-policy',
  hooks: {
    before: [
      {
        matcher: (ctx) => ctx.path === '/oauth2/register',
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as { redirect_uris?: string[] } | undefined
          if (!isLocalRegistration(body?.redirect_uris)) {
            logger.info({ redirectUris: body?.redirect_uris }, 'dcr rejected')
            throw new APIError('BAD_REQUEST', {
              error: 'invalid_redirect_uri',
              error_description: 'redirect_uris must be loopback or private-use scheme URIs',
            })
          }
          return { context: { body: { ...body, application_type: 'native' } } }
        }),
      },
    ],
  },
} satisfies BetterAuthPlugin

/**
 * genericOAuth プロバイダの account.issuer を明示するための値。
 * better-auth が discovery を持たないプロバイダへ与える合成 issuer と同じ形式にしてある。
 *
 * better-auth 1.7 から account の識別子が `(issuer, accountId)` になり、既定では
 * discovery の issuer が入る。それをそのまま使うと下記2点で困るので固定する。
 *
 * - devuntu: issuer がメイン devuntu の baseURL になるため、環境ごとに値が変わってしまう
 * - google-account: ログイン用 'google' と同じ Google アカウント(= 同じ sub)を
 *   別用途で持つ設計なので、issuer まで同じだと `(issuer, accountId)` が衝突する
 *
 * この値は account.issuer として永続化され、照合にも使われる。変えると既存の行に一致せず
 * 連携し直しが必要になるので、一度動かした後は変更しないこと。
 */
const accountIssuer = (providerId: string) => `local:oauth:${providerId}`

const oauthConfigs: GenericOAuthConfig[] = []
if (
  !!envu.server.MAIN_DEVUNTU_URL &&
  !!envu.server.MAIN_DEVUNTU_CLIENT_ID &&
  !!envu.server.MAIN_DEVUNTU_CLIENT_SECRET
) {
  oauthConfigs.push({
    providerId: 'devuntu',
    accountIssuer: accountIssuer('devuntu'),
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
    accountIssuer: accountIssuer(GOOGLE_ACCOUNT_PROVIDER_ID),
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

// Slack 通知の宛先を特定するための連携(Sign in with Slack / OIDC)。
// ここで得るトークンはプロフィール取得専用で、DM 送信には使えない(送信は Bot トークン)。
// 必要なのは Slack ユーザーID(`U...`)だけで、slackUserInfo が返す sub が
// プリセットの accountSubject 経由で account.accountId に入る。
if (!!envu.server.SLACK_CLIENT_ID && !!envu.server.SLACK_CLIENT_SECRET) {
  oauthConfigs.push({
    ...slack({
      clientId: envu.server.SLACK_CLIENT_ID,
      clientSecret: envu.server.SLACK_CLIENT_SECRET,
      // 'profile' が無いと userinfo に name が返らず better-auth が name_is_missing で失敗する
      scopes: ['openid', 'profile', 'email'],
      pkce: true,
      disableSignUp: true,
    }),
    providerId: SLACK_PROVIDER_ID,
    // プリセットの実装は Slack が 200 + `ok:false` を返す失敗を検出できないので差し替える
    getUserInfo: slackUserInfo,
    // 認可画面のワークスペースを固定する(該当ワークスペースで認証済みなら同意を省ける)
    ...(envu.server.SLACK_TEAM_ID && { authorizationUrlParams: { team: envu.server.SLACK_TEAM_ID } }),
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
      scopes: [...MCP_SCOPES],
      // MCP 側の維持期間はWebログインセッションから独立させる(offline_access は MCP_SCOPES にのみ含む)
      refreshTokenExpiresIn: envu.server.MCP_REFRESH_TOKEN_EXPIRES_IN,
      // oauth-provider 1.7 以降、標準クレームは userinfo 専用になった。
      // ID token しか読まないクライアント(NetBird の Dex コネクタ等)向けに載せ直す
      customIdTokenClaims: ({ user, scopes }) => idTokenStandardClaims(user, scopes),

      /**
       * クライアント管理API(`/oauth2/create-client` など)を管理者だけに開く。
       * 未設定だとセッションがあるだけで通ってしまい、ログインできる利用者なら誰でも
       * 自分の OAuth クライアントを登録できる。
       */
      clientPrivileges: ({ user }) => user?.role === 'admin',

      /**
       * 動的クライアント登録(RFC 7591)。MCP クライアントは事前設定を持てないので未認証で開く。
       * 登録できてもデータは読めない。実際のアクセスは authorize でのログインと同意、
       * および /api/mcp 側の権限チェックで守る。受け入れる範囲は dcrPolicy で絞っている。
       */
      allowDynamicClientRegistration: envu.server.OIDC_DCR_ENABLED,
      allowUnauthenticatedClientRegistration: envu.server.OIDC_DCR_ENABLED,
      clientRegistrationDefaultScopes: [...MCP_SCOPES],

      // enforcePerClientResources(既定 true)により、リンクされたクライアントだけがこのリソースを
      // 要求できる。既存の OIDC ログイン用クライアントはリンクされないので MCP トークンを取れない
      resources: [{ identifier: MCP_RESOURCE, name: 'Devuntu MCP', allowedScopes: [...MCP_SCOPES] }],
      clientRegistrationDefaultResources: [MCP_RESOURCE],
    }),
    dcrPolicy,
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
