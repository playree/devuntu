/**
 * 文字列の整形ユーティリティ
 *
 * ドメインに依存しない純粋関数のみを置く。
 */

/** 上限を超える分を切り捨てる。末尾に省略記号を付けて途中で切れたことを示す */
export const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)
