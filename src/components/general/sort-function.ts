import { SortDescriptor } from '@heroui/react'
import { AsyncListLoadFunction } from '@react-stately/data'

/** クライアント側ページングの既定の並べ替え。文字列 / 数値 / 真偽値 / 日時を列の値で比べ、空値は先頭へ寄せる */
export const sortFunction: AsyncListLoadFunction<Record<string, unknown>, string> = async <
  T extends Record<string, unknown>,
>({
  items,
  sortDescriptor,
}: {
  items: T[]
  sortDescriptor?: SortDescriptor
}) => {
  // useAsyncList が持つ配列をそのまま並べ替えると state を書き換えてしまうので、複製してから並べる
  return {
    items: [...items].sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      let cmp = 0
      if (sortDescriptor) {
        const { column, direction } = sortDescriptor
        if (column) {
          const acol = a[String(column)]
          const bcol = b[String(column)]

          // string
          if (typeof acol === 'string' && typeof bcol === 'string') {
            cmp = acol.localeCompare(bcol)
          }
          // number
          else if (typeof acol === 'number' && typeof bcol === 'number') {
            cmp = acol == bcol ? 0 : acol < bcol ? -1 : 1
          }
          // boolean
          else if (typeof acol === 'boolean' && typeof bcol === 'boolean') {
            cmp = acol == bcol ? 0 : acol < bcol ? -1 : 1
          }
          // Date
          else if (acol instanceof Date && bcol instanceof Date) {
            // == は参照の比較になるので、同じ時刻でも別インスタンスだと等しくならない
            cmp = acol.getTime() - bcol.getTime()
          }
          //
          else if (!acol || !bcol) {
            cmp = !acol && !bcol ? 0 : !!acol ? 1 : -1
          }
        }

        if (direction === 'descending') {
          cmp *= -1
        }
      }

      return cmp
    }),
  }
}
