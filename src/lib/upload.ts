import { uuidv7 } from 'uuidv7'

/**
 * アップロードファイルのキーとURLの相互変換。
 *
 * オブジェクトストレージのキーは `<uuidv7>.<拡張子>` のフラット構成にして、
 * 公開URLは `/api/upload/<キー>` になる。DBにはこの公開URLを文字列として保存する。
 * サーバー/クライアント両方から import するため、Node固有のモジュールは使わない。
 */

export const UPLOAD_URL_PREFIX = '/api/upload'

/** 許可するキーの形式(`<uuidv7>.<拡張子>`) */
const UPLOAD_KEY_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(webp|png|jpe?g|gif)$/

/** 保存キーから公開URLを生成 */
export const toUploadUrl = (key: string) => `${UPLOAD_URL_PREFIX}/${key}`

/** 公開URL(`/api/upload/<キー>`)から保存キーを取り出す */
export const toUploadKey = (url: string) => url.slice(url.lastIndexOf('/') + 1)

/** 保存キーの形式検証(ホワイトリスト方式のため別途のパストラバーサル対策は不要) */
export const isValidUploadKey = (key: string) => UPLOAD_KEY_REGEX.test(key)

/** 新規保存用のキーを生成する */
export const newUploadKey = (ext: string) => `${uuidv7()}.${ext}`

/**
 * 画像をアップロードして公開URLを返す(MDXEditor の imageUploadHandler 用)。
 * 失敗時は throw して MDXEditor 側にエラーを表示させる。
 */
export const uploadImage = async (file: File) => {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(UPLOAD_URL_PREFIX, { method: 'POST', body: form })
  if (!res.ok) {
    const { message } = await res.json().catch(() => ({ message: undefined }))
    throw new Error(message ?? `upload failed: ${res.status}`)
  }
  const { url } = (await res.json()) as { url: string }
  return url
}
