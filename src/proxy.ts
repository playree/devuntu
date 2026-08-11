import { NextRequest, NextResponse } from 'next/server'
import { getServerSession, redirectSignIn, redirectTwoFaEnable } from './lib/auth'
import { authConfig } from './lib/auth-config'
import { envu } from './lib/env-util'
import { logger } from './lib/logger'
import { matchCondition } from './lib/match'
import { localeConfig } from './locale/config'

export const proxy = async (request: NextRequest) => {
  const {
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
      // 未ログイン。cb はサインイン画面で safeCallbackPath を通すため自サイト内のパスで渡す
      return redirectSignIn(pathname)
    }
    if (envu.server.TWO_FA_REQUIRED && !envu.server.DISABLE_PASSWORD_AUTH) {
      if (!session.user.twoFactorEnabled) {
        // 2FA必須化
        return redirectTwoFaEnable(pathname)
      }
    }

    // 管理者
    if (matchCondition(pathname, authConfig.target.admin)) {
      if (session.user.role !== 'admin') {
        logger.debug({ pathname, role: session.user.role }, 'proxy admin denied')
        return NextResponse.rewrite(new URL('/_not-found', request.url), { status: 404 })
      }
    }
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
