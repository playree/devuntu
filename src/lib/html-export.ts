/**
 * 描画済みの画面を、1 ファイルで完結する HTML として保存する(チケットの HTML 出力)。
 *
 * `buildHtmlDocument` 以外はブラウザ専用。
 */

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char])

/** 保存する HTML 文書を組み立てる。本文は画面と同じ幅・余白の枠に入れる */
export const buildHtmlDocument = ({
  title,
  lang,
  htmlClass,
  bodyClass,
  css,
  body,
}: {
  title: string
  lang: string
  /** `<html>` のクラス。フォント変数とテーマ(light)を引き継ぐ */
  htmlClass: string
  bodyClass: string
  css: string
  /** 本文の HTML(信頼済みの DOM を直列化したもの) */
  body: string
}): string =>
  [
    '<!doctype html>',
    `<html lang="${escapeHtml(lang)}" class="${escapeHtml(htmlClass)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    // 印刷用ページはライト固定。OS がダークでもスクロールバーなどのブラウザ描画部分を白地に揃える
    '<meta name="color-scheme" content="light">',
    `<title>${escapeHtml(title)}</title>`,
    // CSS の文字列に `</style` があると要素がそこで閉じてしまう
    `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`,
    '</head>',
    `<body class="${escapeHtml(bodyClass)}">`,
    `<div class="mx-auto w-full max-w-3xl p-4">${body}</div>`,
    '</body>',
    '</html>',
  ].join('\n')

/**
 * ページに読み込まれている CSS を 1 つにまとめる。
 * `@font-face` は保存先から参照できない相対 URL なので外す(フォントは閲覧環境のものになる)
 */
export const collectPageCss = (): string =>
  Array.from(document.styleSheets)
    .flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules)
      } catch {
        // 別オリジンのシートは中身を読めない
        return []
      }
    })
    .filter((rule) => !(rule instanceof CSSFontFaceRule))
    .map((rule) => rule.cssText)
    .join('\n')

/** 画像 1 枚の取得を待つ上限。応答しない画像で保存が止まらないようにする */
const IMAGE_FETCH_TIMEOUT = 10_000

const toDataUrl = async (src: string): Promise<string> => {
  const res = await fetch(src, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT) })
  if (!res.ok) {
    throw new Error(`${res.status}`)
  }
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * 要素を複製して、保存先でも表示できる形にした HTML を返す。
 * 画像は認証付きの URL(`/api/upload`)もあるため data URI で埋め込み、取得できなければ絶対 URL のまま残す
 */
export const snapshotElement = async (element: HTMLElement): Promise<string> => {
  const clone = element.cloneNode(true) as HTMLElement

  const originals = Array.from(element.querySelectorAll('img'))
  const images = Array.from(clone.querySelectorAll('img'))
  await Promise.all(
    images.map(async (img, i) => {
      const src = originals[i]?.currentSrc || originals[i]?.src
      if (!src) {
        return
      }
      img.removeAttribute('srcset')
      img.removeAttribute('loading')
      img.src = await toDataUrl(src).catch(() => src)
    }),
  )

  clone.querySelectorAll<HTMLAnchorElement>('a[href]:not([href^="#"])').forEach((anchor) => {
    // href プロパティはページの URL を基準に解決済みの絶対 URL を返す
    anchor.setAttribute('href', anchor.href)
  })
  clone.querySelectorAll('[contenteditable]').forEach((node) => node.removeAttribute('contenteditable'))

  return clone.outerHTML
}

/** HTML をファイルとしてダウンロードさせる */
export const downloadHtml = (fileName: string, html: string) => {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  // クリック直後に破棄するとダウンロードが始まらないブラウザがある
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
