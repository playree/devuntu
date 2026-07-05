import { getServerSession } from '@/lib/auth'
import { UPLOAD_DIR, toUploadPath } from '@/lib/upload'
import { readFile } from 'fs/promises'
import { NextResponse } from 'next/server'
import path from 'path'

const CONTENT_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

/**
 * アップロードファイルを配信する
 */
export const GET = async (_req: Request, { params }: { params: Promise<{ filename: string }> }) => {
  // ログイン認証チェック
  const session = await getServerSession()
  if (!session?.user) {
    return new NextResponse(null, { status: 401 })
  }

  const { filename } = await params
  // パストラバーサル対策: ディレクトリ成分を除去
  const safeName = path.basename(filename)
  const filePath = toUploadPath(safeName)
  // 解決後のパスがUPLOAD_DIR配下であることを検証
  if (!filePath.startsWith(UPLOAD_DIR + path.sep)) {
    return new NextResponse(null, { status: 400 })
  }
  try {
    const data = await readFile(filePath)
    const contentType = CONTENT_TYPES[path.extname(safeName).toLowerCase()] ?? 'application/octet-stream'
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': contentType,
        // 認証必須のためprivate。ファイル名はキャッシュバスティング済みのため長期キャッシュ可能
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    })
  } catch {
    return new NextResponse(null, { status: 404 })
  }
}
