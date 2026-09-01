import sharp from 'sharp'
import { errInvalidOperation } from '../error'

/**
 * 画像の正規化。
 *
 * アップロードされた画像はすべて webp に変換して保存する。
 * 拡張子・Content-Type が1種類に固定されるため、配信側の分岐が不要になる。
 */

export const WEBP_EXT = 'webp'
export const WEBP_MIME = 'image/webp'

/**
 * 変換を許可する入力フォーマット。
 *
 * `zImageFile` が見るのは申告された `File.type` だけなので、`image/png` を名乗る SVG のような
 * バイト列がここまで届く。sharp が実データから判定したフォーマットで改めて絞る。
 */
const ALLOWED_INPUT_FORMATS = ['jpeg', 'png', 'webp', 'gif']

type WebpOptions = {
  size: number
  fit: 'cover' | 'inside'
  /** アニメーションを保持するか。読み取り用途では1フレームに潰して軽くする */
  animated?: boolean
  quality?: number
}

const convertToWebp = async (input: Uint8Array, { size, fit, animated = true, quality = 80 }: WebpOptions) => {
  const format = await sharp(input)
    .metadata()
    .then((meta) => meta.format)
    .catch(() => undefined)
  if (!format || !ALLOWED_INPUT_FORMATS.includes(format)) {
    throw errInvalidOperation()
  }
  return sharp(input, { animated })
    .resize(size, size, {
      fit,
      // 元画像が上限より小さい場合に引き伸ばさない
      withoutEnlargement: fit === 'inside',
    })
    .webp({ quality })
    .toBuffer()
}

/**
 * 画像を webp に変換して返す。
 *
 * `fit: 'cover'` は指定サイズの正方形にクロップ(アイコン用途)、
 * `fit: 'inside'` は縦横比を保ったまま長辺を上限に収める(本文挿入用途)。
 * アニメーションGIFを1フレームに潰さないよう `animated: true` で読み込む。
 */
export const toWebp = async (file: File, { size, fit }: { size: number; fit: 'cover' | 'inside' }) =>
  convertToWebp(new Uint8Array(await file.arrayBuffer()), { size, fit })

/**
 * 保存済みの画像を読み取り用に縮小する。
 *
 * 保存時の長辺2000pxのまま MCP へ返すとトークンを浪費するだけなので必ず縮小して渡す。
 * 読み取り用途ではアニメーションを保持せず1フレームに潰す。
 */
export const resizeWebp = async (input: Uint8Array, size: number) =>
  convertToWebp(input, { size, fit: 'inside', animated: false, quality: 75 })
