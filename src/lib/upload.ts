import path from 'path'

export const UPLOAD_DIR = path.join(process.cwd(), 'upload')
export const UPLOAD_URL_PREFIX = '/api/upload'

// 保存ファイル名から公開URLを生成
export const toUploadUrl = (filename: string) => `${UPLOAD_URL_PREFIX}/${path.basename(filename)}`

// ディスク上の絶対パスを生成
export const toUploadPath = (filename: string) => {
  const resolved = path.join(UPLOAD_DIR, path.basename(filename))
  if (!resolved.startsWith(UPLOAD_DIR + path.sep)) {
    throw new Error('Invalid filename')
  }
  return resolved
}
