import { uuidv7 } from 'uuidv7'

/**
 * アップロードファイルのキーとURLの相互変換。
 *
 * オブジェクトストレージのキーは `<uuidv7>.<拡張子>` のフラット構成にして、
 * 公開URLは `/api/upload/<キー>` になる。DBにはこの公開URLを文字列として保存する。
 * サーバー/クライアント両方から import するため、Node固有のモジュールは使わない。
 */

export const UPLOAD_URL_PREFIX = '/api/upload'

/**
 * アバター画像を未認証で配信するパス。実体は `/api/upload` と同じキーを指す。
 *
 * OIDC クライアントへ `picture` として渡すため認証を掛けられない。
 * **DBにはこの形式で保存しないこと**。参照判定({@link isUploadUrl})が `/api/upload` 始まりしか
 * 見ておらず、保存形式を変えると未参照とみなされて添付の掃除で消える。
 */
export const AVATAR_URL_PREFIX = '/api/avatar'

/**
 * 許可するキーの形式(`<uuidv7>.<拡張子>`)。
 * ファイル添付は元の拡張子を残すため、拡張子は形式だけを見る({@link toUploadExt} で正規化したもの)
 */
const UPLOAD_KEY_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]{1,10}$/

/** 拡張子として使えない名前のファイルに付ける拡張子 */
const FALLBACK_EXT = 'bin'

/**
 * ファイル名からキーに使う拡張子を取り出す。
 * 小文字の英数字10文字までに収まらないもの(拡張子なしを含む)は `bin` にする
 */
export const toUploadExt = (filename: string) => {
  const dot = filename.lastIndexOf('.')
  const ext = dot > 0 ? filename.slice(dot + 1).toLowerCase() : ''
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : FALLBACK_EXT
}

/** 保存キーから公開URLを生成 */
export const toUploadUrl = (key: string) => `${UPLOAD_URL_PREFIX}/${key}`

/** 保存キーからアバターの未認証配信URLを生成 */
export const toAvatarUrl = (key: string) => `${AVATAR_URL_PREFIX}/${key}`

/** 公開URL(`/api/upload/<キー>`)から保存キーを取り出す */
export const toUploadKey = (url: string) => url.slice(url.lastIndexOf('/') + 1)

/**
 * この保存先が管理下のアップロードURLか。
 *
 * 区切りの `/` まで含めて見ることで `/api/uploads-xxx` のような別パスを取り違えない。
 * 外部URL(ソーシャルログインで取得した画像など)を除外する判定に使う。
 */
export const isUploadUrl = (url: string) => url.startsWith(`${UPLOAD_URL_PREFIX}/`)

/** 保存キーの形式検証(ホワイトリスト方式のため別途のパストラバーサル対策は不要) */
export const isValidUploadKey = (key: string) => UPLOAD_KEY_REGEX.test(key)

/**
 * 本文(Markdown)に含まれる `/api/upload/<キー>` から保存キーを重複なく取り出す。
 *
 * 形式検証を通したものだけ返すので、本文へ手書きされた任意の文字列がキーとして扱われることはない。
 */
export const extractUploadKeys = (content: string): string[] => {
  const matches = content.matchAll(new RegExp(`${UPLOAD_URL_PREFIX}/([\\w-]+\\.[a-z0-9]+)`, 'g'))
  const keys = new Set<string>()
  for (const [, key] of matches) {
    if (isValidUploadKey(key)) {
      keys.add(key)
    }
  }
  return [...keys]
}

/** ファイルサイズの表示(`512 B` / `1.2 KB` / `3.4 MB`) */
export const formatFileSize = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const kb = bytes / 1024
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`
  }
  return `${(kb / 1024).toFixed(1)} MB`
}

/**
 * ダウンロード時のファイル名。本文に貼った画像は保存時に webp へ変換しているので、
 * 拡張子だけを保存形式に合わせる(`shot.png` → `shot.webp`)。名前部分は残す
 */
export const toDownloadName = (originalName: string, mimeType: string) => {
  if (mimeType !== 'image/webp' || /\.webp$/i.test(originalName)) {
    return originalName
  }
  const dot = originalName.lastIndexOf('.')
  return `${dot > 0 ? originalName.slice(0, dot) : originalName}.webp`
}

/** 新規保存用のキーを生成する */
export const newUploadKey = (ext: string) => `${uuidv7()}.${ext}`

/** アップロード時に添付先ボードを伝えるフォームフィールド名。配信時の可視判定に使う */
export const UPLOAD_BOARD_ID_FIELD = 'boardId'

/** アップロード時に添付先の Wiki スペースを伝えるフォームフィールド名。{@link UPLOAD_BOARD_ID_FIELD} とは同時に送らない */
export const UPLOAD_WIKI_SPACE_ID_FIELD = 'wikiSpaceId'

/** 添付先。配信時の可視判定に使う。両方とも省略すると全ログインユーザーが参照できる添付になる */
export type UploadTarget = { boardId?: string | null; wikiSpaceId?: string | null }

/**
 * アップロードの種類を伝えるクエリパラメータ名(`?kind=file`)。省略時は画像として扱う。
 * サーバーがボディを読む前に上限を決められるよう、フォームではなくクエリで渡す
 */
export const UPLOAD_KIND_PARAM = 'kind'

export type UploadKind = 'image' | 'file'

const upload = async (file: File, kind: UploadKind, { boardId, wikiSpaceId }: UploadTarget = {}) => {
  const form = new FormData()
  form.append('file', file)
  // 両方あればそのまま送り、サーバーの 400 で誤った渡し方に気づけるようにする
  if (boardId) {
    form.append(UPLOAD_BOARD_ID_FIELD, boardId)
  }
  if (wikiSpaceId) {
    form.append(UPLOAD_WIKI_SPACE_ID_FIELD, wikiSpaceId)
  }
  const url = kind === 'file' ? `${UPLOAD_URL_PREFIX}?${UPLOAD_KIND_PARAM}=file` : UPLOAD_URL_PREFIX
  const res = await fetch(url, { method: 'POST', body: form })
  if (!res.ok) {
    const { message } = await res.json().catch(() => ({ message: undefined }))
    throw new Error(message ?? `upload failed: ${res.status}`)
  }
  return ((await res.json()) as { url: string }).url
}

/**
 * 画像をアップロードして公開URLを返す(MDXEditor の imageUploadHandler 用)。
 * 失敗時は throw して MDXEditor 側にエラーを表示させる。
 *
 * `boardId` を渡すとその添付はボードのメンバーに、`wikiSpaceId` を渡すとそのスペースを閲覧できる人にしか配信されない。
 * どちらも省略した場合は全ログインユーザーが参照できる(お知らせなどボードに属さない本文向け)。
 */
export const uploadImage = (file: File, target?: UploadTarget) => upload(file, 'image', target)

/** ファイルを変換せずにアップロードして公開URLを返す。添付先の扱いは {@link uploadImage} と同じ */
export const uploadFile = (file: File, target?: UploadTarget) => upload(file, 'file', target)
