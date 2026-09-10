import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/server-utils'
import { WEBP_MIME } from '@/lib/storage/image'
import { getObject } from '@/lib/storage/storage'
import { isValidUploadKey, toUploadUrl } from '@/lib/storage/upload'
import { NextResponse } from 'next/server'

/**
 * アバター画像を認証なしで配信する。
 *
 * 自身をIdPとして使う OIDC クライアントへ `picture` クレームで渡すURLの実体。
 * クライアントは Devuntu のログインセッションを持たないので、`/api/upload` のように
 * 認証を掛けると読めない。
 *
 * 公開するのは**今この瞬間に誰かのアバターとして参照されているキーだけ**に限る。
 * 同じ `boardId: null` の添付でも、お知らせ本文の画像や LinkWidget のアイコンは対象外
 * (それらは従来どおりログイン必須の `/api/upload` からしか読めない)。
 *
 * キーは保存ごとに変わる uuidv7 なので推測はできないが、キーを知る第三者は誰でも読める。
 * `src/proxy.ts` の matcher は `api/` を除外しているため、自前でレート制限を掛ける。
 */

/** 未認証で開くため、画像の埋め込み用途として無理のない範囲に抑える */
const AVATAR_RATE_LIMIT = { limit: 120, windowMs: 10 * 60 * 1000 }

export const GET = async (_req: Request, { params }: { params: Promise<{ filename: string }> }) => {
  const { filename } = await params
  // 形式が違うものはDBに触る前に落とす
  if (!isValidUploadKey(filename)) {
    return new NextResponse(null, { status: 400 })
  }

  if (!consumeRateLimit(`avatar:${await getClientIp()}`, AVATAR_RATE_LIMIT)) {
    logger.warn({ scope: 'avatar' }, 'rate limit exceeded')
    return new NextResponse(null, { status: 429 })
  }

  // アバターとして参照されていないキーは、添付として存在していても未存在と同じ扱いにする
  const user = await prisma.user.findFirst({ where: { image: toUploadUrl(filename) }, select: { id: true } })
  if (!user) {
    return new NextResponse(null, { status: 404 })
  }

  const object = await getObject(filename)
  if (!object) {
    return new NextResponse(null, { status: 404 })
  }

  return new NextResponse(object.body, {
    headers: {
      // アバターは saveImageAttachment 経由でしか作られず、必ずwebpに正規化されている
      'Content-Type': WEBP_MIME,
      ...(object.contentLength ? { 'Content-Length': String(object.contentLength) } : {}),
      'X-Content-Type-Options': 'nosniff',
      /**
       * 未認証で読めるため public。ただし immutable は付けない。
       * キーは保存ごとに変わるのでアバターの差し替えでは陳腐化しないが、
       * 削除された後も共有キャッシュが返し続ける窓をこの長さに抑える。
       */
      'Cache-Control': 'public, max-age=3600',
      'X-Robots-Tag': 'noindex',
    },
  })
}
