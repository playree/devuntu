import { getServerSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getObject } from '@/lib/storage'
import { isValidUploadKey } from '@/lib/upload'
import { NextResponse } from 'next/server'

/**
 * アップロードファイルを配信する。
 *
 * オブジェクトストレージへ直リンクさせず必ずここを通すことで、参照にも
 * ログイン認証を強制する(署名付きURLは使わないのでURLが漏れても読めない)。
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
    select: { mimeType: true },
  })
  if (!attachment) {
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
      // 認証必須のためprivate。キーは保存ごとに変わるため長期キャッシュ可能
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
}
