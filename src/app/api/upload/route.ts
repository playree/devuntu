import { getServerSession } from '@/lib/auth/auth'
import { getBoardAccess } from '@/lib/board/board'
import { ClientError } from '@/lib/error'
import { logger } from '@/lib/logger'
import { consumeRateLimit } from '@/lib/rate-limit'
import { MAX_IMAGE_SIZE, zImageFile } from '@/lib/schema/schema'
import { saveContentImage } from '@/lib/storage/attachment'
import { UPLOAD_BOARD_ID_FIELD } from '@/lib/storage/upload'
import { resolveUploadToken, type UploadActor } from '@/lib/storage/upload-token'
import { LocaleItem } from '@/locale'
import { localeConfig } from '@/locale/config'
import { t } from '@/locale/server'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'

/**
 * 画像をアップロードしてオブジェクトストレージに保存する。
 *
 * Server Action ではなく Route Handler にしているのは、MDXEditor の
 * `imageUploadHandler` が fetch 前提であること、および Server Action の
 * `bodySizeLimit`(既定1MB)の制約を受けないため。
 * `src/proxy.ts` の matcher は `api/` を除外しているのでここで自前認証する。
 *
 * 認証は2経路ある。ブラウザはログインセッション、MCPクライアントは
 * `create_image_upload_token` が発行した短命トークンの Bearer で入る。
 */

/** multipart のオーバーヘッド分だけ画像上限より緩める。これを超えるボディは読まずに捨てる */
const MAX_BODY_SIZE = MAX_IMAGE_SIZE + 1024 * 1024

/** 濫用のコストを上げるための緩い制限。ブラウザからの連続貼り付けは通る値にする */
const UPLOAD_RATE_LIMIT = { limit: 60, windowMs: 10 * 60 * 1000 }

/** ロケールキーのまま返しても呼び元(`uploadImage`)が解決できないので、ここで文言にする */
const badRequest = async (message: LocaleItem) => {
  const locale = (await cookies()).get(localeConfig.cookie.name)?.value ?? null
  return NextResponse.json({ message: t(locale, message) }, { status: 400 })
}

export const POST = async (req: Request) => {
  // 巨大なボディを formData() でメモリに載せてしまう前に弾く
  const contentLength = Number(req.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_SIZE) {
    return new NextResponse(null, { status: 413 })
  }

  // Bearer がある場合は短命トークン経路。無ければ従来どおりログインセッションで判定する
  const byToken = await resolveUploadToken(req)
  if (byToken && !byToken.ok) {
    return new NextResponse(null, { status: 401 })
  }

  const form = await req.formData().catch(() => null)

  let actor: UploadActor
  if (byToken) {
    // 添付先はトークンで確定しているため、フォームの boardId は見ない
    actor = byToken.actor
  } else {
    const session = await getServerSession()
    if (!session?.user) {
      return new NextResponse(null, { status: 401 })
    }
    /**
     * 添付先のボード。配信(`/api/upload/<key>`)の可視判定に使う。
     * 未指定は「ボードに属さない本文」(お知らせなど)とみなし全ログインユーザーへ配信する。
     * 指定がある場合はその時点でメンバーであることを確認し、他人のボードへ紐付けさせない。
     */
    const boardIdInput = form?.get(UPLOAD_BOARD_ID_FIELD)
    const boardId = typeof boardIdInput === 'string' ? (z.uuidv7().safeParse(boardIdInput).data ?? false) : null
    if (boardId === false) {
      return new NextResponse(null, { status: 400 })
    }
    if (boardId && !(await getBoardAccess(session.user, boardId))) {
      return new NextResponse(null, { status: 403 })
    }
    actor = { userId: session.user.id, boardId }
  }

  if (!consumeRateLimit(`upload:${actor.userId}`, UPLOAD_RATE_LIMIT)) {
    return new NextResponse(null, { status: 429 })
  }

  const parsed = zImageFile.safeParse(form?.get('file'))
  if (!parsed.success) {
    return await badRequest((parsed.error.issues[0]?.message ?? '@invalid_image_type') as LocaleItem)
  }

  try {
    const { url } = await saveContentImage(parsed.data, actor)
    return NextResponse.json({ url })
  } catch (err) {
    // 申告と中身が違う画像(SVG など)は変換前に弾かれる。想定内なので 500 にはしない
    if (err instanceof ClientError) {
      return await badRequest('@invalid_image_type')
    }
    logger.error({ err, userId: actor.userId }, 'attachment upload failed')
    throw err
  }
}
