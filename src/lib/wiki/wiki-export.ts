/**
 * Wiki ページの出力(PDF / HTML / Markdown)のパス・文書タイトル・Markdown の組み立て
 *
 * サーバー / クライアントの双方から import する純粋関数のみを置く。
 */
import type { WikiPageType } from '@/generated/prisma/enums'
import { exportFileName, PRINT_PATH_PREFIX, setPrintFormatParam, withQuery, type PrintFormat } from '../print-export'
import { UPLOAD_URL_PREFIX } from '../storage/upload'

/** 印刷用ページのクエリで版を指すキー */
export const WIKI_PRINT_REVISION_PARAM = 'rev'

/** 印刷用ページのパス。revisionId を渡すとその版の内容を出す。format は既定の pdf ならクエリに付けない */
export const wikiPrintPath = (
  { key, number }: { key: string; number: number },
  { revisionId, format = 'pdf' }: { revisionId?: string; format?: PrintFormat } = {},
): string => {
  const query = new URLSearchParams()
  if (revisionId) {
    query.set(WIKI_PRINT_REVISION_PARAM, revisionId)
  }
  setPrintFormatParam(query, format)
  return withQuery(`${PRINT_PATH_PREFIX}wiki/${encodeURIComponent(key)}/${number}`, query)
}

/**
 * 出力の文書タイトル(`KEY-番号 タイトル`)。ブラウザが「PDFに保存」の既定ファイル名に使い、HTML / Markdown のファイル名にもする。
 * 過去の版は版数を付ける
 */
export const wikiExportTitle = ({
  key,
  number,
  title,
  revisionNumber,
}: {
  key: string
  number: number
  title: string
  /** 過去の版のときの版数 */
  revisionNumber?: number
}): string => `${key}-${number} ${title}${revisionNumber === undefined ? '' : ` (v${revisionNumber})`}`

/** 出力の保存ファイル名 */
export const wikiExportFileName = (title: string, ext: 'html' | 'md'): string => exportFileName(title, ext, 'wiki')

// 括弧・空白・引用符・`<`・`=` の直後(Markdown の画像やリンク、参照形式の定義、HTML の属性)にあるアップロードの相対 URL
const UPLOAD_URL_PATTERN = new RegExp(`(^|[\\s("'<=])${UPLOAD_URL_PREFIX}/`, 'g')

/** 本文のアップロード画像・添付の相対 URL(`/api/upload/...`)を絶対 URL にする。保存した .md を別の場所で開いても辿れるように */
export const absolutizeUploadUrls = (markdown: string, origin: string): string =>
  markdown.replace(UPLOAD_URL_PATTERN, (_, before: string) => `${before}${origin}${UPLOAD_URL_PREFIX}/`)

/**
 * Markdown 出力の内容。通常のページは先頭にタイトルの見出しを付ける。
 * 設計書は front matter が先頭にある必要があり、タイトルもそこに持つので本文のまま出す
 */
export const wikiMarkdownExport = ({
  title,
  type,
  content,
  origin,
}: {
  title: string
  type: WikiPageType
  content: string
  origin: string
}): string => {
  const body = absolutizeUploadUrls(content, origin)
  if (type === 'design_doc') {
    return body
  }
  return body.trim() ? `# ${title}\n\n${body}` : `# ${title}\n`
}
