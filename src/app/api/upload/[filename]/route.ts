import { getActiveSession } from '@/lib/auth/auth'
import { prisma } from '@/lib/prisma'
import { ACCEPTED_IMAGE_TYPES } from '@/lib/schema/schema'
import { canViewAttachment } from '@/lib/storage/attachment-access'
import { getObject } from '@/lib/storage/storage'
import { isValidUploadKey } from '@/lib/storage/upload'
import { resolveDownloadToken } from '@/lib/storage/upload-token'

/**
 * 画像以外(ファイル添付)はブラウザで開かせずダウンロードさせる。
 * 万一開かれた場合の CSP の sandbox は next.config.ts で付ける(ここで付けても全体の CSP で上書きされる)
 */
const fileHeaders = (originalName: string) => ({
  // RFC 5987 の attr-char に無い ' ( ) * は encodeURIComponent が残すので、自前で符号化する
  'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(originalName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )}`,
})

/**
 * アップロードファイルを配信する。
 *
 * オブジェクトストレージへ直リンクさせず必ずここを通すことで、参照にも
 * ログイン認証を強制する(署名付きURLは使わないのでURLが漏れても読めない)。
 *
 * さらに添付先ボード(Attachment.boardId)があるものはそのボードの可視判定も通す
 * (承認者の扱いは `canViewAttachment`)。
 * ログイン済みなら誰でも読めると、プライベートボードのチケットに貼った画像が
 * URL さえ知られれば他ユーザーから読めてしまうため。
 * Wiki スペースの添付(Attachment.wikiSpaceId)は、そのスペースの閲覧権限で判定する。
 * どちらも null のものはボードに属さない本文(お知らせ / リンクウィジェットのアイコン)なので
 * 全ログインユーザーへ配信してよい。
 *
 * MCP クライアントは `get_file` が発行した短命トークンの Bearer で入る(対象のキーに紐づく)。
 */
export const GET = async (req: Request, { params }: { params: Promise<{ filename: string }> }) => {
  const { filename } = await params
  if (!isValidUploadKey(filename)) {
    return new Response(null, { status: 400 })
  }

  const byToken = await resolveDownloadToken(req, filename)
  const user = byToken ? (byToken.ok ? byToken.user : null) : (await getActiveSession())?.user
  if (!user) {
    return new Response(null, { status: 401 })
  }

  // 存在しないキーはストレージを叩かずに返す
  const attachment = await prisma.attachment.findUnique({
    where: { key: filename },
    select: { mimeType: true, boardId: true, wikiSpaceId: true, originalName: true },
  })
  if (!attachment) {
    return new Response(null, { status: 404 })
  }

  // アクセス不可は未存在と区別せず 404 にして、キーの当たり判定を返さない
  if (
    !(await canViewAttachment(user, {
      key: filename,
      boardId: attachment.boardId,
      wikiSpaceId: attachment.wikiSpaceId,
    }))
  ) {
    return new Response(null, { status: 404 })
  }

  const object = await getObject(filename)
  if (!object) {
    return new Response(null, { status: 404 })
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': attachment.mimeType,
      ...(object.contentLength ? { 'Content-Length': String(object.contentLength) } : {}),
      // 保存時に型を正規化しているが、Content-Type を推測させない
      'X-Content-Type-Options': 'nosniff',
      ...(ACCEPTED_IMAGE_TYPES.includes(attachment.mimeType) ? {} : fileHeaders(attachment.originalName)),
      // 認証必須のためprivate。キーは保存ごとに変わるため長期キャッシュ可能
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
}
