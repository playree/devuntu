import { getActiveSession } from '@/lib/auth/auth'
import { assertBoardAccess, type Actor } from '@/lib/board/board-access'
import { envu } from '@/lib/env-util'
import { ClientError } from '@/lib/error'
import { logger } from '@/lib/logger'
import { MAINTENANCE_MODE_RETRY_AFTER_SEC } from '@/lib/maintenance/maintenance'
import { isMaintenanceMode } from '@/lib/maintenance/maintenance-mode'
import { consumeRateLimit } from '@/lib/rate-limit'
import { MAX_IMAGE_SIZE, zAttachmentFile, zImageFile } from '@/lib/schema/schema'
import { saveContentFile, saveContentImage } from '@/lib/storage/attachment'
import { UPLOAD_BOARD_ID_FIELD, UPLOAD_KIND_PARAM, UPLOAD_WIKI_SPACE_ID_FIELD } from '@/lib/storage/upload'
import { resolveUploadToken, type UploadActor } from '@/lib/storage/upload-token'
import { assertWikiSpaceAccess } from '@/lib/wiki/wiki-access'
import { LocaleItem } from '@/locale'
import { requestLocale } from '@/locale/request'
import { t } from '@/locale/server'
import { z } from 'zod'

/**
 * 画像・ファイルをアップロードしてオブジェクトストレージに保存する。
 * クエリの `kind=file` はファイル添付(変換せず保存)、それ以外は画像(webp に変換)として扱う。
 * 種類をボディではなくクエリで受けるのは、ボディを読む前に上限を決めるため。
 *
 * Server Action ではなく Route Handler にしているのは、MDXEditor の
 * `imageUploadHandler` が fetch 前提であること、および Server Action の
 * `bodySizeLimit`(既定1MB)の制約を受けないため。
 * `src/proxy.ts` は `api/` の認証を素通しにしているのでここで自前認証する。
 * このパスは Proxy の matcher から外してあるので、メンテナンスモードの遮断もここで行う。
 *
 * 認証は2経路ある。ブラウザはログインセッション、MCPクライアントは
 * `create_image_upload_token` が発行した短命トークンの Bearer で入る。
 * どちらも**本文を読む前に**判定し、未認証のリクエストにメモリを使わせない。
 */

/** 添付ファイルの上限(バイト)。環境変数で変わるので都度読む */
const maxFileSize = () => envu.server.ATTACHMENT_MAX_SIZE_MB * 1024 * 1024

/** multipart のオーバーヘッド分だけ上限より緩める。これを超えるボディは読み切らずに捨てる */
const MULTIPART_OVERHEAD = 1024 * 1024

/** 濫用のコストを上げるための緩い制限。ブラウザからの連続貼り付けは通る値にする */
const UPLOAD_RATE_LIMIT = { limit: 60, windowMs: 10 * 60 * 1000 }

/** ロケールキーのまま返しても呼び元(`uploadImage`)が解決できないので、ここで文言にする */
const badRequest = async (message: LocaleItem, values?: Record<string, number>) =>
  Response.json({ message: t(await requestLocale(), message, values) }, { status: 400 })

type UploadAuth = { kind: 'token'; actor: UploadActor } | { kind: 'session'; user: Actor }

/** 本文の解析より前に済ませる認証。Bearer があれば短命トークン、無ければログインセッションで見る */
const authenticate = async (req: Request): Promise<UploadAuth | null> => {
  const byToken = await resolveUploadToken(req)
  if (byToken) {
    return byToken.ok ? { kind: 'token', actor: byToken.actor } : null
  }
  const user = (await getActiveSession())?.user
  return user ? { kind: 'session', user } : null
}

/** 権限が無いことだけを false にし、DB エラーなどはそのまま投げて 500 にする */
const isPermitted = (assertion: Promise<unknown>): Promise<boolean> =>
  assertion.then(
    () => true,
    (err) => {
      if (err instanceof ClientError) {
        return false
      }
      throw err
    },
  )

/** 添付先ボードへ本文を書けるか(メンバー かつ 未アーカイブ)。MCP の添付と同じ判定を使う */
const canWriteBoard = (user: Actor, boardId: string): Promise<boolean> =>
  isPermitted(assertBoardAccess(user, boardId, 'write'))

/** 添付先の Wiki スペースへページを書けるか(editor 以上 かつ 未アーカイブ) */
const canWriteWikiSpace = (user: Actor, spaceId: string): Promise<boolean> =>
  isPermitted(assertWikiSpaceAccess(user, spaceId, 'write'))

/** フォームの ID 項目。未指定は null、uuidv7 でなければ false */
const readIdField = (form: FormData, name: string): string | null | false => {
  const value = form.get(name)
  if (value === null) {
    return null
  }
  return typeof value === 'string' ? (z.uuidv7().safeParse(value).data ?? false) : false
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
  if (isMaintenanceMode()) {
    return Response.json(
      { error: 'maintenance' },
      { status: 503, headers: { 'Retry-After': String(MAINTENANCE_MODE_RETRY_AFTER_SEC) } },
    )
  }

  const isFile = new URL(req.url).searchParams.get(UPLOAD_KIND_PARAM) === 'file'
  // 正直な申告の巨大リクエストは、ストリームを流す前にここで落とす
  const maxBody = (isFile ? maxFileSize() : MAX_IMAGE_SIZE) + MULTIPART_OVERHEAD
  const contentLength = Number(req.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBody) {
    return new Response(null, { status: 413 })
  }

  const auth = await authenticate(req)
  if (!auth) {
    return new Response(null, { status: 401 })
  }

  const userId = auth.kind === 'token' ? auth.actor.userId : auth.user.id
  if (!consumeRateLimit(`upload:${userId}`, UPLOAD_RATE_LIMIT)) {
    return new Response(null, { status: 429 })
  }

  const limited = limitBody(req, maxBody)
  const form = await limited.request.formData().catch(() => null)
  if (!form) {
    return new Response(null, { status: limited.isExceeded() ? 413 : 400 })
  }

  let actor: UploadActor
  if (auth.kind === 'token') {
    // 添付先はトークンで確定しているため、フォームの boardId / wikiSpaceId は見ない
    actor = auth.actor
  } else {
    /**
     * 添付先のボード / Wiki スペース。配信(`/api/upload/<key>`)の可視判定に使う。
     * どちらも未指定は「ボードに属さない本文」(お知らせなど)とみなし全ログインユーザーへ配信する。
     * 指定がある場合はその時点で書き込めることを確認し、他人のボード・スペースへ紐付けさせない。
     */
    const boardId = readIdField(form, UPLOAD_BOARD_ID_FIELD)
    const wikiSpaceId = readIdField(form, UPLOAD_WIKI_SPACE_ID_FIELD)
    if (boardId === false || wikiSpaceId === false || (boardId && wikiSpaceId)) {
      return new Response(null, { status: 400 })
    }
    if (boardId && !(await canWriteBoard(auth.user, boardId))) {
      return new Response(null, { status: 403 })
    }
    if (wikiSpaceId && !(await canWriteWikiSpace(auth.user, wikiSpaceId))) {
      return new Response(null, { status: 403 })
    }
    actor = { userId, boardId, wikiSpaceId }
  }

  if (isFile) {
    const parsed = zAttachmentFile(maxFileSize()).safeParse(form.get('file'))
    if (!parsed.success) {
      const message = (parsed.error.issues[0]?.message ?? '@invalid_file_size') as LocaleItem
      return await badRequest(message, { max: envu.server.ATTACHMENT_MAX_SIZE_MB })
    }
    try {
      const { url } = await saveContentFile(parsed.data, actor)
      return Response.json({ url })
    } catch (err) {
      logger.error({ err, userId }, 'file attachment upload failed')
      throw err
    }
  }

  const parsed = zImageFile.safeParse(form.get('file'))
  if (!parsed.success) {
    return await badRequest((parsed.error.issues[0]?.message ?? '@invalid_image_type') as LocaleItem)
  }

  try {
    const { url } = await saveContentImage(parsed.data, actor)
    return Response.json({ url })
  } catch (err) {
    // 申告と中身が違う画像(SVG など)は変換前に弾かれる。想定内なので 500 にはしない
    if (err instanceof ClientError) {
      return await badRequest('@invalid_image_type')
    }
    logger.error({ err, userId }, 'attachment upload failed')
    throw err
  }
}
