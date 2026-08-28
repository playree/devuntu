import sharp from 'sharp'

/**
 * 画像の正規化。
 *
 * アップロードされた画像はすべて webp に変換して保存する。
 * 拡張子・Content-Type が1種類に固定されるため、配信側の分岐が不要になる。
 */

export const WEBP_EXT = 'webp'
export const WEBP_MIME = 'image/webp'

/**
 * 画像を webp に変換して返す。
 *
 * `fit: 'cover'` は指定サイズの正方形にクロップ(アイコン用途)、
 * `fit: 'inside'` は縦横比を保ったまま長辺を上限に収める(本文挿入用途)。
 * アニメーションGIFを1フレームに潰さないよう `animated: true` で読み込む。
 */
export const toWebp = async (file: File, { size, fit }: { size: number; fit: 'cover' | 'inside' }) => {
  const buffer = Buffer.from(await file.arrayBuffer())
  return sharp(buffer, { animated: true })
    .resize(size, size, {
      fit,
      // 元画像が上限より小さい場合に引き伸ばさない
      withoutEnlargement: fit === 'inside',
    })
    .webp({ quality: 80 })
    .toBuffer()
}
