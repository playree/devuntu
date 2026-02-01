import { NextRequest, NextResponse } from 'next/server'
import { logger } from './lib/logger'

export const proxy = (request: NextRequest) => {
  const {
    method,
    nextUrl: { pathname },
  } = request
  logger.debug({ pathname, method }, 'proxy start')

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
