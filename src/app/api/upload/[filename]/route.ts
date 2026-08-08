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
  // ホワイトリスト方式の形式検証。スラッシュや`..`は通らないのでパストラバーサルにならない
  if (!isValidUploadKey(filename)) {
    return new NextResponse(null, { status: 400 })
  }

  const object = await getObject(filename)
  if (!object) {
    return new NextResponse(null, { status: 404 })
  }

  /**
   * Content-Type は Attachment レコードを優先する。
   * ローカル保存時代から移行したファイルはレコードを持たないため、
   * ストレージ側の Content-Type にフォールバックする(存在確認はストレージが担う)。
   */
  const attachment = await prisma.attachment.findUnique({
    where: { key: filename },
    select: { mimeType: true },
  })

  return new NextResponse(object.body, {
    headers: {
      'Content-Type': attachment?.mimeType ?? object.contentType ?? 'application/octet-stream',
      ...(object.contentLength ? { 'Content-Length': String(object.contentLength) } : {}),
      // 認証必須のためprivate。キーは保存ごとに変わるため長期キャッシュ可能
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
}
