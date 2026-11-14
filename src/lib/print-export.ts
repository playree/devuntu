/**
 * 印刷用ページ(PDF / HTML 出力)で共通に使う定数とファイル名の組み立て
 *
 * サーバー / クライアントの双方から import する純粋関数のみを置く。
 */

/** 印刷用ページのパスの接頭辞。配下はダーク設定でもライトで表示する */
export const PRINT_PATH_PREFIX = '/print/'

/** 印刷用ページのクエリで出力形式を指すキー */
export const PRINT_FORMAT_PARAM = 'format'

/** 印刷用ページの出力形式。pdf は印刷ダイアログを開き、html は自己完結の HTML ファイルを保存する */
export const PRINT_FORMATS = ['pdf', 'html'] as const
export type PrintFormat = (typeof PRINT_FORMATS)[number]

/** クエリの値を出力形式にする。未指定・不正値は pdf */
export const parsePrintFormat = (value: unknown): PrintFormat =>
  PRINT_FORMATS.find((format) => format === value) ?? 'pdf'

/** 出力形式をクエリに付ける。既定の pdf なら付けない */
export const setPrintFormatParam = (query: URLSearchParams, format: PrintFormat) => {
  if (format !== 'pdf') {
    query.set(PRINT_FORMAT_PARAM, format)
  }
}

/** パスにクエリを付ける。空なら付けない */
export const withQuery = (path: string, query: URLSearchParams): string => (query.size > 0 ? `${path}?${query}` : path)

/** 保存するファイル名。OS でファイル名に使えない文字は `_` に置き換え、空なら fallback にする */
export const exportFileName = (title: string, ext: string, fallback: string): string =>
  `${title.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').trim() || fallback}.${ext}`
