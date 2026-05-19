import { NextRequest, NextResponse } from 'next/server'
import { getServerSession, redirectSignIn, redirectTwoFaEnable } from './lib/auth'
import { authConfig } from './lib/auth-config'
import { envu } from './lib/env-util'
import { logger } from './lib/logger'
import { matchCondition } from './lib/match'
import { localeConfig } from './locale/config'

export const proxy = async (request: NextRequest) => {
  const {
    url,
    method,
    nextUrl: { pathname },
  } = request
  logger.debug({ pathname, method }, 'proxy in')

  // 認証
  let session
  if (matchCondition(pathname, authConfig.target.auth)) {
    session = await getServerSession()
    logger.debug({ session }, 'proxy auth')
    if (!session?.user) {
      // 未ログイン
      return redirectSignIn(url)
    }
    if (envu.server.TWO_FA_REQUIRED && !envu.server.DISABLE_PASSWORD_AUTH) {
      if (!session.user.twoFactorEnabled) {
        // 2FA必須化
        return redirectTwoFaEnable(url)
      }
    }

    // 管理者
  }

  const response = NextResponse.next()

  if (session?.user) {
    // ロケールCookie
    if (request.method.toUpperCase() === 'GET') {
      if (!request.cookies.has(localeConfig.cookie.name)) {
        // ロケールCookieが存在しない場合かつ、ユーザーのロケールが取得できる場合にはCookieを発行
        if (session.user.locale) {
          logger.debug({ locale: session.user.locale }, 'set locale cookie')
          response.cookies.set({
            name: localeConfig.cookie.name,
            value: session.user.locale,
            path: '/',
            httpOnly: false,
            maxAge: localeConfig.cookie.maxAge,
          })
        }
      }
    }
  }

  return response
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|_next/webpack-hmr|api/|.*\\.).*)',
      missing: [
        // Server Actions を除外する
        { type: 'header', key: 'next-action' },
      ],
    },
  ],
}
