import { Prisma } from '@/generated/prisma/client'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { toWebp, toWebpBytes, WEBP_EXT, WEBP_MIME } from './image'
import { fetchRemoteImage } from './remote-image'
import { deleteObject, putObject } from './storage'
import { isUploadUrl, newUploadKey, toUploadKey, toUploadUrl } from './upload'

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

/** アイコン用途の一辺(px) */
const ICON_SIZE = 128

const saveSquareImage = async (bytes: Uint8Array, originalName: string, userId: string, size: number) => {
  const webp = await toWebpBytes(bytes, { size, fit: 'cover' }) // 正方形にクロップ
  const attachment = await storeWebp(webp, { originalName, boardId: null, userId })
  return toUploadUrl(attachment.key)
}

/**
 * 画像を正方形にクロップしてwebpでオブジェクトストレージに保存し、公開URLを返す。
 * LinkWidgetアイコン・ユーザーアバターなど、全ログインユーザーへ配信してよい画像
 * (Attachment.boardId は null のまま)で共通利用する。
 */
export const saveImageAttachment = async (file: File, userId: string, size = ICON_SIZE) =>
  saveSquareImage(new Uint8Array(await file.arrayBuffer()), file.name, userId, size)

/**
 * 外部URLのアバター画像を取得して保存し、公開URLを返す。
 *
 * OIDC/ソーシャルログインの `picture` を Devuntu 側へコピーする用途。ログインの途中で走るため、
 * 取得・変換・保存のどこで失敗しても例外にせず undefined を返してサインインを続けさせる。
 *
 * **null ではなく undefined を返すこと。** 呼び出し元(better-auth のプロフィール同期)は
 * undefined を「更新しない」として扱うが、null はそのまま `image = NULL` として書き込まれる。
 */
export const saveImageAttachmentFromUrl = async (url: string, userId: string): Promise<string | undefined> => {
  const bytes = await fetchRemoteImage(url)
  if (!bytes) {
    return undefined
  }
  try {
    const saved = await saveSquareImage(bytes, 'avatar', userId, ICON_SIZE)
    logger.info({ userId }, 'remote avatar copied')
    return saved
  } catch (err) {
    // 変換できない形式・ストレージ障害。次回ログインで再試行される
    logger.warn({ err, userId }, 'failed to copy remote avatar')
    return undefined
  }
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

/**
 * 添付をキーで消す。**実体 → レコードの順**で消す。
 *
 * 逆順にすると、レコードだけ消えて実体が残った場合に誰もそのキーへ辿り着けなくなり、
 * DBを起点にした掃除の対象から永久に外れる。この順なら実体だけ消えた中途半端な状態でも
 * レコードが残るので、次の掃除が同じキーを拾い直して収束する。
 * 存在しないキーの削除はどちらもエラーにならないため、やり直しても壊れない。
 */
export const removeAttachmentByKey = async (key: string): Promise<boolean> => {
  try {
    await deleteObject(key)
    // レコードが無いキーもありうるためdeleteManyで許容する
    await prisma.attachment.deleteMany({ where: { key } })
    return true
  } catch (err) {
    // 呼び出し元は成功扱いのまま進む(ベストエフォート)。追跡できるよう詳細を残す
    logger.error({ err, key }, 'failed to remove attachment')
    return false
  }
}

/**
 * saveImageAttachment で保存した画像を削除する。
 *
 * 管理下のURLでなければ何もしない。`toUploadKey` は最後の `/` 以降を切り出すだけなので、
 * 外部URLを渡すと無関係な文字列をキーとしてストレージへ投げてしまう。
 */
export const removeImageAttachment = async (url: string): Promise<void> => {
  if (!isUploadUrl(url)) {
    return
  }
  // urlは`/api/upload/<key>`形式なのでキーを抽出
  await removeAttachmentByKey(toUploadKey(url))
}

/**
 * ボードに属する添付のキー。紐付けを外すとボードから辿れなくなるので、
 * 実体を消すには**外す前に**控えておく必要がある。
 */
export const listBoardAttachmentKeys = async (tx: Prisma.TransactionClient, boardId: string): Promise<string[]> => {
  const rows = await tx.attachment.findMany({ where: { boardId }, select: { key: true } })
  return rows.map(({ key }) => key)
}

/**
 * ボードに属する添付の紐付けを外す。ボード削除の直前に呼ぶ。
 *
 * Cascade でレコードごと消すと、実体の削除に失敗した分がどこからも辿れなくなる。
 * 行を残しておけば未参照の添付として掃除が拾い直すので、失敗しても収束する。
 */
export const detachBoardAttachments = async (tx: Prisma.TransactionClient, boardId: string): Promise<void> => {
  await tx.attachment.updateMany({ where: { boardId }, data: { boardId: null } })
}
