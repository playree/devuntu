import { getServerSession } from '@/lib/auth/auth'
import { getBoardAccess } from '@/lib/board/board'
import { prisma } from '@/lib/prisma'
import { getObject } from '@/lib/storage/storage'
import { isValidUploadKey } from '@/lib/storage/upload'
import { NextResponse } from 'next/server'

/**
 * アップロードファイルを配信する。
 *
 * オブジェクトストレージへ直リンクさせず必ずここを通すことで、参照にも
 * ログイン認証を強制する(署名付きURLは使わないのでURLが漏れても読めない)。
 *
 * さらに添付先ボード(Attachment.boardId)があるものはそのボードの可視判定も通す。
 * ログイン済みなら誰でも読めると、プライベートボードのチケットに貼った画像が
 * URL さえ知られれば他ユーザーから読めてしまうため。
 * boardId が null のものはボードに属さない本文(お知らせ / リンクウィジェットのアイコン)なので
 * 全ログインユーザーへ配信してよい。
 */
export const GET = async (_req: Request, { params }: { params: Promise<{ filename: string }> }) => {
  // ログイン認証チェック
  const session = await getServerSession()
  if (!session?.user) {
    return new NextResponse(null, { status: 401 })
  }

  const { filename } = await params
  if (!isValidUploadKey(filename)) {
    return new NextResponse(null, { status: 400 })
  }

  // 存在しないキーはストレージを叩かずに返す
  const attachment = await prisma.attachment.findUnique({
    where: { key: filename },
    select: { mimeType: true, boardId: true },
  })
  if (!attachment) {
    return new NextResponse(null, { status: 404 })
  }

  // アクセス不可は未存在と区別せず 404 にして、キーの当たり判定を返さない
  if (attachment.boardId && !(await getBoardAccess(session.user, attachment.boardId))) {
    return new NextResponse(null, { status: 404 })
  }

  const object = await getObject(filename)
  if (!object) {
    return new NextResponse(null, { status: 404 })
  }

  return new NextResponse(object.body, {
    headers: {
      'Content-Type': attachment.mimeType,
      ...(object.contentLength ? { 'Content-Length': String(object.contentLength) } : {}),
      // 保存時に webp へ正規化しているが、Content-Type を推測させない
      'X-Content-Type-Options': 'nosniff',
      // 認証必須のためprivate。キーは保存ごとに変わるため長期キャッシュ可能
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
}
