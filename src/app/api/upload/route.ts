import { getServerSession } from '@/lib/auth/auth'
import { getBoardAccess, type Actor } from '@/lib/board/board'
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
 * どちらも**本文を読む前に**判定し、未認証のリクエストにメモリを使わせない。
 */

/** multipart のオーバーヘッド分だけ画像上限より緩める。これを超えるボディは読み切らずに捨てる */
const MAX_BODY_SIZE = MAX_IMAGE_SIZE + 1024 * 1024

/** 濫用のコストを上げるための緩い制限。ブラウザからの連続貼り付けは通る値にする */
const UPLOAD_RATE_LIMIT = { limit: 60, windowMs: 10 * 60 * 1000 }

/** ロケールキーのまま返しても呼び元(`uploadImage`)が解決できないので、ここで文言にする */
const badRequest = async (message: LocaleItem) => {
  const locale = (await cookies()).get(localeConfig.cookie.name)?.value ?? null
  return NextResponse.json({ message: t(locale, message) }, { status: 400 })
}

type UploadAuth = { kind: 'token'; actor: UploadActor } | { kind: 'session'; user: Actor }

/** 本文の解析より前に済ませる認証。Bearer があれば短命トークン、無ければログインセッションで見る */
const authenticate = async (req: Request): Promise<UploadAuth | null> => {
  const byToken = await resolveUploadToken(req)
  if (byToken) {
    return byToken.ok ? { kind: 'token', actor: byToken.actor } : null
  }
  const user = (await getServerSession())?.user
  return user ? { kind: 'session', user } : null
}

/**
 * ボディを読みながら実バイト数で打ち切るリクエストを作る。
 *
 * `Content-Length` は省略でき(chunked)、値も送り手が決めるものなので、事前判定だけでは
 * 巨大な本文をメモリへ載せられてしまう。上限を超えた時点でストリームを落とし、
 * `formData()` を失敗させる。
 */
const limitBody = (req: Request, max: number) => {
  let exceeded = false
  if (!req.body) {
    return { request: req, isExceeded: () => exceeded }
  }

  let read = 0
  const body = req.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        read += chunk.byteLength
        if (read > max) {
          exceeded = true
          controller.error(new Error('request body too large'))
          return
        }
        controller.enqueue(chunk)
      },
    }),
  )

  // ストリームをボディにする場合 duplex が必須。RequestInit の型には無いのでキャストする
  const init = { method: req.method, headers: req.headers, body, duplex: 'half' } as RequestInit
  return { request: new Request(req.url, init), isExceeded: () => exceeded }
}

export const POST = async (req: Request) => {
  // 正直な申告の巨大リクエストは、ストリームを流す前にここで落とす
  const contentLength = Number(req.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_SIZE) {
    return new NextResponse(null, { status: 413 })
  }

  const auth = await authenticate(req)
  if (!auth) {
    return new NextResponse(null, { status: 401 })
  }

  const userId = auth.kind === 'token' ? auth.actor.userId : auth.user.id
  if (!consumeRateLimit(`upload:${userId}`, UPLOAD_RATE_LIMIT)) {
    return new NextResponse(null, { status: 429 })
  }

  const limited = limitBody(req, MAX_BODY_SIZE)
  const form = await limited.request.formData().catch(() => null)
  if (!form) {
    return new NextResponse(null, { status: limited.isExceeded() ? 413 : 400 })
  }

  let actor: UploadActor
  if (auth.kind === 'token') {
    // 添付先はトークンで確定しているため、フォームの boardId は見ない
    actor = auth.actor
  } else {
    /**
     * 添付先のボード。配信(`/api/upload/<key>`)の可視判定に使う。
     * 未指定は「ボードに属さない本文」(お知らせなど)とみなし全ログインユーザーへ配信する。
     * 指定がある場合はその時点でメンバーであることを確認し、他人のボードへ紐付けさせない。
     */
    const boardIdInput = form.get(UPLOAD_BOARD_ID_FIELD)
    const boardId = typeof boardIdInput === 'string' ? (z.uuidv7().safeParse(boardIdInput).data ?? false) : null
    if (boardId === false) {
      return new NextResponse(null, { status: 400 })
    }
    if (boardId && !(await getBoardAccess(auth.user, boardId))) {
      return new NextResponse(null, { status: 403 })
    }
    actor = { userId, boardId }
  }

  const parsed = zImageFile.safeParse(form.get('file'))
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
    logger.error({ err, userId }, 'attachment upload failed')
    throw err
  }
}
