'use client'

import { absolutizeRootLinks, toDataUrl } from '@/lib/html-export'
import { readNoFile, resolveResource } from './design-doc-view'

/** 画像の src を、埋め込む data URI か、取得できなければ絶対 URL にする。解決できない src は例外にして元のまま残させる */
const embedImage = async (path: string): Promise<string> => {
  const url = new URL(resolveResource(path), window.location.origin).href
  return toDataUrl(url).catch(() => url)
}

/**
 * 設計書を、Markdown Design Doc Viewer の HTML エクスポート(拡張・CLI)と同じ 1 ファイルの HTML にする。ブラウザ専用。
 * 図はこのページの中で描く。図の寸法はビューアのスタイルで測るので viewer.css も読み込む。
 * 画像(アップロードは認証付き)は data URI で埋め込み、取得できなければ絶対 URL にする。
 * ルートからの相対リンク(Wiki のページ・添付)は、保存したファイルから開けるよう絶対 URL にする
 */
export const exportDesignDocHtml = async ({
  markdown,
  title,
  lang,
}: {
  markdown: string
  /** 設計書にタイトル(front matter の title・`#` 見出し)が無いときのページのタイトル */
  title: string
  lang: 'ja' | 'en'
}): Promise<string> => {
  const [{ exportHtml }] = await Promise.all([
    import('markdown-design-doc-viewer-embed/export'),
    import('markdown-design-doc-viewer-embed/viewer.css'),
  ])
  const html = await exportHtml({ markdown, title, lang, readFile: readNoFile, resolveImage: embedImage })
  return absolutizeRootLinks(html, window.location.origin)
}
