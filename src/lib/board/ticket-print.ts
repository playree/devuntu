/**
 * チケットの印刷用ページ(PDF / HTML 出力)のパス・文書タイトルの組み立て
 *
 * サーバー / クライアントの双方から import する純粋関数のみを置く。
 */
import { exportFileName, PRINT_PATH_PREFIX, setPrintFormatParam, withQuery, type PrintFormat } from '../print-export'

/** 印刷用ページのクエリでプラン/報告書の 1 件を指すキー */
export const PRINT_COMMENT_PARAM = 'comment'

/** 印刷用ページのパス。commentId を渡すとそのプラン/報告書だけを出す。format は既定の pdf ならクエリに付けない */
export const ticketPrintPath = (
  ticketId: string,
  { commentId, format = 'pdf' }: { commentId?: string; format?: PrintFormat } = {},
): string => {
  const query = new URLSearchParams()
  if (commentId) {
    query.set(PRINT_COMMENT_PARAM, commentId)
  }
  setPrintFormatParam(query, format)
  return withQuery(`${PRINT_PATH_PREFIX}tickets/${encodeURIComponent(ticketId)}`, query)
}

/**
 * 印刷用ページの文書タイトル。ブラウザが「PDFに保存」の既定ファイル名に使う。
 * プラン/報告書の単体は種別名を、チケット全体は件名を表示IDに続ける
 */
export const ticketPrintTitle = ({
  displayId,
  title,
  typeLabel,
}: {
  displayId: string
  title: string
  /** プラン/報告書の単体のときの種別名 */
  typeLabel?: string
}): string => `${displayId} ${typeLabel ?? title}`

/** HTML 出力の保存ファイル名。OS でファイル名に使えない文字は `_` に置き換える */
export const ticketExportFileName = (title: string): string => exportFileName(title, 'html', 'ticket')

/** 種別(プラン/報告書)が付いたコメント */
export type PrintableComment<C extends { type: string | null }> = C & { type: NonNullable<C['type']> }

/**
 * 印刷できるコメント(プラン/報告書)を返す。返信も含めて探し、通常のコメントや見つからない場合は null。
 * スレッドは 1 階層のみなので、親とその返信だけを見ればよい
 */
export const findPrintableComment = <C extends { id: string; type: string | null }>(
  comments: (C & { replies: C[] })[],
  commentId: string,
): PrintableComment<C> | null => {
  const all: C[] = comments.flatMap((comment) => [comment, ...comment.replies])
  return (
    all.find((comment): comment is PrintableComment<C> => comment.id === commentId && comment.type !== null) ?? null
  )
}
