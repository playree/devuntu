import { NextRequest, NextResponse } from 'next/server'
import { getServerSession, redirectSignIn, redirectTwoFaEnable } from './lib/auth'
import { authConfig } from './lib/auth-config'
import { envu } from './lib/env-util'
import { logger } from './lib/logger'
import { matchCondition } from './lib/match'

export const proxy = async (request: NextRequest) => {
  const {
    url,
    method,
    nextUrl: { pathname },
  } = request
  logger.debug({ pathname, method }, 'proxy in')

  // 認証
  if (matchCondition(pathname, authConfig.target.auth)) {
    const session = await getServerSession()
    logger.debug({ session }, 'proxy auth')
    if (!session) {
      // 未ログイン
      return redirectSignIn(url)
    }
    if (envu.server.TWO_FA_REQUIRED) {
      if (!session.user.twoFactorEnabled) {
        // 2FA必須化
        return redirectTwoFaEnable(url)
      }
    }

    // 管理者
  }

  return NextResponse.next()
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
