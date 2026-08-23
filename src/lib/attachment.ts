import { toWebp, WEBP_EXT, WEBP_MIME } from './image'
import { logger } from './logger'
import { prisma } from './prisma'
import { deleteObject, putObject } from './storage'
import { newUploadKey, toUploadKey, toUploadUrl } from './upload'

/**
 * 画像を正方形にクロップしてwebpでオブジェクトストレージに保存し、公開URLを返す。
 * LinkWidgetアイコン・ユーザーアバターなど、全ログインユーザーへ配信してよい画像
 * (Attachment.boardId は null のまま)で共通利用する。
 */
export const saveImageAttachment = async (file: File, userId: string, size = 128) => {
  const webp = await toWebp(file, { size, fit: 'cover' }) // 正方形にクロップ
  // キャッシュバスティング: 保存ごとにユニークなキーにしてURLを変え、更新を反映させる
  const key = newUploadKey(WEBP_EXT)
  await putObject(key, webp, WEBP_MIME)
  await prisma.attachment.create({
    data: { key, mimeType: WEBP_MIME, size: webp.byteLength, originalName: file.name, createdById: userId },
  })
  return toUploadUrl(key)
}

/** saveImageAttachment で保存した画像を削除する */
export const removeImageAttachment = async (url: string): Promise<void> => {
  // urlは`/api/upload/<key>`形式なのでキーを抽出
  const key = toUploadKey(url)
  try {
    await deleteObject(key)
    // レコードが無いキーもありうるためdeleteManyで許容する
    await prisma.attachment.deleteMany({ where: { key } })
  } catch (err) {
    logger.warn({ err, url }, 'failed to remove image attachment')
  }
}
