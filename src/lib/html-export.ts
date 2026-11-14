/**
 * 描画済みの画面を、1 ファイルで完結する HTML として保存する(チケット・Wiki の HTML 出力)。
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

/** 複製した画像の src を、元の画像から取った data URI にする。取得できなければ絶対 URL のまま残す */
const inlineImages = async (originals: HTMLImageElement[], images: HTMLImageElement[]) => {
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
}

/**
 * 元の要素の open な shadow root を、複製の側に宣言的 shadow DOM(`<template shadowrootmode="open">`)として書き出す。
 * `cloneNode` は shadow root を複製しないため(設計書のワイヤーフレームなど)。shadow root の中の shadow root は扱わない
 */
const serializeShadowRoots = async (element: HTMLElement, clone: HTMLElement) => {
  const originals = Array.from(element.querySelectorAll('*'))
  // 書き出すと複製の要素の並びが変わるので、先に対応を取っておく
  const clones = Array.from(clone.querySelectorAll('*'))
  await Promise.all(
    originals.map(async (original, i) => {
      const shadow = original.shadowRoot
      const target = clones[i]
      if (!shadow || !target) {
        return
      }
      const template = document.createElement('template')
      template.setAttribute('shadowrootmode', 'open')
      template.innerHTML = shadow.innerHTML
      await inlineImages(
        Array.from(shadow.querySelectorAll('img')),
        Array.from(template.content.querySelectorAll('img')),
      )
      target.prepend(template)
    }),
  )
}

/**
 * 要素を複製して、保存先でも表示できる形にした HTML を返す。
 * 画像は認証付きの URL(`/api/upload`)もあるため data URI で埋め込み、取得できなければ絶対 URL のまま残す
 */
export const snapshotElement = async (element: HTMLElement): Promise<string> => {
  const clone = element.cloneNode(true) as HTMLElement

  await serializeShadowRoots(element, clone)
  await inlineImages(Array.from(element.querySelectorAll('img')), Array.from(clone.querySelectorAll('img')))

  clone.querySelectorAll<HTMLAnchorElement>('a[href]:not([href^="#"])').forEach((anchor) => {
    // href プロパティはページの URL を基準に解決済みの絶対 URL を返す
    anchor.setAttribute('href', anchor.href)
  })
  clone.querySelectorAll('[contenteditable]').forEach((node) => node.removeAttribute('contenteditable'))

  return clone.outerHTML
}

/** 文字列をファイルとしてダウンロードさせる。type は charset 付きの MIME タイプ */
export const downloadText = (fileName: string, text: string, type: string) => {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  // クリック直後に破棄するとダウンロードが始まらないブラウザがある
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** HTML をファイルとしてダウンロードさせる */
export const downloadHtml = (fileName: string, html: string) => downloadText(fileName, html, 'text/html;charset=utf-8')
