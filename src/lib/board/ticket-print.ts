/**
 * チケットの印刷用ページ(PDF 出力)のパス・文書タイトルの組み立て
 *
 * サーバー / クライアントの双方から import する純粋関数のみを置く。
 */

/** 印刷用ページのパスの接頭辞。配下はダーク設定でもライトで表示する */
export const PRINT_PATH_PREFIX = '/print/'

/** 印刷用ページのクエリでプラン/報告書の 1 件を指すキー */
export const PRINT_COMMENT_PARAM = 'comment'

/** 印刷用ページのパス。commentId を渡すとそのプラン/報告書だけを出す */
export const ticketPrintPath = (ticketId: string, commentId?: string): string => {
  const path = `${PRINT_PATH_PREFIX}tickets/${encodeURIComponent(ticketId)}`
  return commentId ? `${path}?${new URLSearchParams({ [PRINT_COMMENT_PARAM]: commentId })}` : path
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
