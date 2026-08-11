import { getServerSession } from '@/lib/auth'
import { getBoardAccess } from '@/lib/board'
import { toWebp, WEBP_EXT, WEBP_MIME } from '@/lib/image'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { zImageFile } from '@/lib/schema'
import { putObject } from '@/lib/storage'
import { newUploadKey, toUploadUrl, UPLOAD_BOARD_ID_FIELD } from '@/lib/upload'
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
 */
export const POST = async (req: Request) => {
  // ログイン認証チェック
  const session = await getServerSession()
  if (!session?.user) {
    return new NextResponse(null, { status: 401 })
  }

  const form = await req.formData().catch(() => null)

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

  const file = form?.get('file')
  const parsed = zImageFile.safeParse(file)
  if (!parsed.success) {
    /**
     * Zod のメッセージはロケールキー(`@invalid_image_size` など)なので、
     * ここで解決して返す。MDXEditor はエラーメッセージをそのまま表示するため、
     * クライアント側では翻訳できない。
     */
    const locale = (await cookies()).get(localeConfig.cookie.name)?.value ?? null
    const message = parsed.error.issues[0]?.message
    return NextResponse.json({ message: message ? t(locale, message as LocaleItem) : undefined }, { status: 400 })
  }

  // 保存形式はwebpに統一する。長辺のみ上限を掛けて縦横比は保つ
  const webp = await toWebp(parsed.data, { size: 2000, fit: 'inside' })
  const key = newUploadKey(WEBP_EXT)
  await putObject(key, webp, WEBP_MIME)

  const attachment = await prisma.attachment.create({
    data: {
      key,
      mimeType: WEBP_MIME,
      size: webp.byteLength,
      originalName: parsed.data.name,
      boardId,
      createdById: session.user.id,
    },
  })
  logger.info({ key, size: webp.byteLength, boardId, userId: session.user.id }, 'attachment uploaded')

  return NextResponse.json({ url: toUploadUrl(attachment.key) })
}
