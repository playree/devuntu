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

/**
 * 本文(Markdown)に含まれる `/api/upload/<キー>` から保存キーを重複なく取り出す。
 *
 * 添付を本文の保存先ボードへ紐付け直すために使う。形式検証を通したものだけ返すので、
 * 本文へ手書きされた任意の文字列がそのままキーとして扱われることはない。
 */
export const extractUploadKeys = (content: string): string[] => {
  const matches = content.matchAll(new RegExp(`${UPLOAD_URL_PREFIX}/([\\w.-]+)`, 'g'))
  const keys = new Set<string>()
  for (const [, key] of matches) {
    if (isValidUploadKey(key)) {
      keys.add(key)
    }
  }
  return [...keys]
}

/** 新規保存用のキーを生成する */
export const newUploadKey = (ext: string) => `${uuidv7()}.${ext}`

/** アップロード時に添付先ボードを伝えるフォームフィールド名。配信時の可視判定に使う */
export const UPLOAD_BOARD_ID_FIELD = 'boardId'

/**
 * 画像をアップロードして公開URLを返す(MDXEditor の imageUploadHandler 用)。
 * 失敗時は throw して MDXEditor 側にエラーを表示させる。
 *
 * `boardId` を渡すとその添付はボードのメンバーにしか配信されない。
 * 省略した場合は全ログインユーザーが参照できる(お知らせなどボードに属さない本文向け)。
 */
export const uploadImage = async (file: File, boardId?: string | null) => {
  const form = new FormData()
  form.append('file', file)
  if (boardId) {
    form.append(UPLOAD_BOARD_ID_FIELD, boardId)
  }
  const res = await fetch(UPLOAD_URL_PREFIX, { method: 'POST', body: form })
  if (!res.ok) {
    const { message } = await res.json().catch(() => ({ message: undefined }))
    throw new Error(message ?? `upload failed: ${res.status}`)
  }
  const { url } = (await res.json()) as { url: string }
  return url
}
