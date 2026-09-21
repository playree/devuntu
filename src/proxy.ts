import { NextRequest, NextResponse } from 'next/server'
import { getServerSession, redirectSignIn, redirectTwoFaEnable } from './lib/auth/auth'
import { authConfig } from './lib/auth/auth-config'
import { envu } from './lib/env-util'
import { logger } from './lib/logger'
import { MAINTENANCE_MODE_RETRY_AFTER_SEC } from './lib/maintenance/maintenance'
import { isMaintenanceMode, MAINTENANCE_MODE_TARGET } from './lib/maintenance/maintenance-mode'
import { matchCondition } from './lib/match'
import { localeConfig } from './locale/config'

/**
 * 認証を Proxy では扱わない経路か。
 *
 * API ルートと Server Action は、レコード単位の認可を各ハンドラ側で行っている
 * (`assertBoardAccess` / `assertTicketAccess` など)。matcher から除外していたのを
 * メンテナンスモードの遮断のために外したので、ここで従来と同じ「素通し」に戻す。
 */
const bypassesProxyAuth = (request: NextRequest) =>
  request.nextUrl.pathname.startsWith('/api/') || request.headers.has('next-action')

export const proxy = async (request: NextRequest) => {
  const {
    method,
    nextUrl: { pathname, search },
  } = request
  logger.debug({ pathname, method }, 'proxy in')

  const bypassAuth = bypassesProxyAuth(request)

  /**
   * メンテナンスモード。画面・Server Action・API を1箇所で塞ぐ。
   *
   * 判定はファイルの有無だけで、セッションを引かない(DB リストア中でも動く必要がある)。
   * このため管理者も含めて全員が遮断される。解除は `pnpm maintenance off`。
   *
   * Next.js v16 の Proxy は既定で Node.js ランタイムのため `node:fs` を使える
   * (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`)。
   */
  if (matchCondition(pathname, MAINTENANCE_MODE_TARGET) && isMaintenanceMode()) {
    logger.debug({ pathname }, 'proxy maintenance')
    const headers = { 'Retry-After': String(MAINTENANCE_MODE_RETRY_AFTER_SEC) }
    if (bypassAuth) {
      return NextResponse.json({ error: 'maintenance' }, { status: 503, headers })
    }
    return NextResponse.rewrite(new URL('/maintenance', request.url), { status: 503, headers })
  }

  if (bypassAuth) {
    return NextResponse.next()
  }

  // 認証
  let session
  if (matchCondition(pathname, authConfig.target.auth)) {
    session = await getServerSession()
    logger.debug({ session }, 'proxy auth')
    if (!session?.user) {
      // cb はサインイン画面で safeCallbackPath を通すため自サイト内のパスで渡す。
      // クエリまで含めるのは /consent の署名付きクエリを再ログインで失わないため
      return redirectSignIn(`${pathname}${search}`)
    }
    if (envu.server.TWO_FA_REQUIRED && !envu.server.DISABLE_PASSWORD_AUTH) {
      if (!session.user.twoFactorEnabled) {
        return redirectTwoFaEnable(`${pathname}${search}`)
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

  /**
   * meta robots を読まない取得元にも届くよう、ヘッダでも同じ指示を返す。
   * 付くのは通常処理を継続したページ応答だけ(適用範囲は docs/environment-variables.md)。
   */
  if (!envu.server.SEARCH_ENGINE_INDEXING) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  }

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

/**
 * `api/` と Server Action(`next-action` ヘッダ)を**除外していない**。
 * メンテナンスモードの遮断を Proxy 1箇所に集約するためで、通常時の扱いは
 * `bypassesProxyAuth` で従来どおり素通しに戻している。
 *
 * 拡張子を含むパス(`.*\.`)と `_next/*` は除外したまま。メンテナンス画面のアセットを配信するため。
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|_next/webpack-hmr|.*\\.).*)'],
}
