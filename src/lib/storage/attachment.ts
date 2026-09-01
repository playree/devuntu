import { logger } from '../logger'
import { prisma } from '../prisma'
import { toWebp, WEBP_EXT, WEBP_MIME } from './image'
import { deleteObject, putObject } from './storage'
import { newUploadKey, toUploadKey, toUploadUrl } from './upload'

/**
 * 変換済みのwebpをオブジェクトストレージへ保存し、Attachment を作る。
 * キーは保存ごとにユニークにして、URLの変化でキャッシュバスティングも兼ねる。
 */
const storeWebp = async (webp: Uint8Array, meta: { originalName: string; boardId: string | null; userId: string }) => {
  const key = newUploadKey(WEBP_EXT)
  await putObject(key, webp, WEBP_MIME)
  try {
    return await prisma.attachment.create({
      data: {
        key,
        mimeType: WEBP_MIME,
        size: webp.byteLength,
        originalName: meta.originalName,
        boardId: meta.boardId,
        createdById: meta.userId,
      },
    })
  } catch (err) {
    // レコード作成に失敗した場合はアップロード済みオブジェクトを残さない
    await deleteObject(key).catch((delErr) => logger.error({ delErr, key }, 'failed to cleanup orphaned object'))
    throw err
  }
}

/**
 * 画像を正方形にクロップしてwebpでオブジェクトストレージに保存し、公開URLを返す。
 * LinkWidgetアイコン・ユーザーアバターなど、全ログインユーザーへ配信してよい画像
 * (Attachment.boardId は null のまま)で共通利用する。
 */
export const saveImageAttachment = async (file: File, userId: string, size = 128) => {
  const webp = await toWebp(file, { size, fit: 'cover' }) // 正方形にクロップ
  const attachment = await storeWebp(webp, { originalName: file.name, boardId: null, userId })
  return toUploadUrl(attachment.key)
}

/**
 * 本文(チケット/コメント/お知らせ)へ貼る画像を保存して公開URLを返す。
 *
 * アイコン用途と違い縦横比は保ったまま長辺だけ上限を掛ける。
 * `boardId` を渡した添付は配信時にそのボードの可視判定を通すので、ボードのメンバーしか読めない。
 * null は全ログインユーザーへ配信してよいもの(お知らせなどボードに属さない本文)。
 */
export const saveContentImage = async (file: File, { boardId, userId }: { boardId: string | null; userId: string }) => {
  // 保存形式はwebpに統一する。長辺のみ上限を掛けて縦横比は保つ
  const webp = await toWebp(file, { size: 2000, fit: 'inside' })
  const attachment = await storeWebp(webp, { originalName: file.name, boardId, userId })
  logger.info({ key: attachment.key, size: attachment.size, boardId, userId }, 'attachment uploaded')
  return { url: toUploadUrl(attachment.key), key: attachment.key, size: attachment.size }
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
    // 呼び出し元は成功扱いのまま進む(ベストエフォート)。追跡できるよう詳細を残す
    logger.error({ err, url, key }, 'failed to remove image attachment')
  }
}
