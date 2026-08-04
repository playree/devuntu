import { SortDescriptor } from '@heroui/react'
import { AsyncListLoadFunction, useAsyncList } from '@react-stately/data'
import { useMemo, useState } from 'react'

export const sortFunction: AsyncListLoadFunction<Record<string, unknown>, string> = async <
  T extends Record<string, unknown>,
>({
  items,
  sortDescriptor,
}: {
  items: T[]
  sortDescriptor?: SortDescriptor
}) => {
  return {
    items: items.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      let cmp = 0
      if (sortDescriptor) {
        const { column, direction } = sortDescriptor
        if (column) {
          const acol = a[String(column)]
          const bcol = b[String(column)]

          // string
          if (typeof acol === 'string' && typeof bcol === 'string') {
            cmp = acol == bcol ? 0 : acol < bcol ? -1 : 1
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
            cmp = acol == bcol ? 0 : acol < bcol ? -1 : 1
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

export const usePagingList = <T extends Record<string, unknown>[], F extends Record<string, string>>({
  load,
  filter,
  sort,
  rowsPerPage = 10,
}: {
  load: () => Promise<T>
  filter?: {
    init: F
    proc: (item: T[0], filters: F) => boolean
  }
  sort?: {
    init?: SortDescriptor
    proc?: AsyncListLoadFunction<Record<string, unknown>, string>
  }
  rowsPerPage?: number
}) => {
  const [page, setPage] = useState(1)
  const sortFunc = sort?.proc || sortFunction

  const list = useAsyncList({
    load: async ({ sortDescriptor, selectedKeys, signal }) => {
      const items = await load()
      if (sortDescriptor) {
        return sortFunc({ items, sortDescriptor, selectedKeys, signal })
      }
      return { items }
    },
    sort: sortFunc,
    initialSortDescriptor: sort?.init,
  })

  const [filters, setFilters] = useState(filter?.init)
  const [filterState] = useState(filter)

  const [lastItems, setLastItems] = useState(list.items)
  if (list.items !== lastItems && !list.isLoading) {
    setLastItems(list.items)
  }

  // フィルタ適用まで(ページ切り出し前)。総件数から先に totalPages を確定させるため分けている
  const filtered = useMemo(() => {
    const displayItems = list.items.length === 0 && list.isLoading ? lastItems : list.items

    return filterState && filters ? displayItems.filter((item) => filterState.proc(item, filters)) : displayItems
  }, [filterState, filters, lastItems, list.isLoading, list.items])

  const total = filtered.length
  const totalPages = Math.ceil(total / rowsPerPage) || 1
  // 削除やリロードで総ページ数が減ったとき、範囲外のページに留まると空表示になるので丸める
  const currentPage = Math.min(page, totalPages)

  const items = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage

    return filtered.slice(start, start + rowsPerPage) as T
  }, [filtered, currentPage, rowsPerPage])

  return {
    items,
    total,
    totalPages,
    page: currentPage,
    rowsPerPage,
    sortDescriptor: list.sortDescriptor,
    onSortChange: list.sort,
    onPageChange: setPage,
    reload: list.reload,
    isLoading: list.isLoading,
    /**
     * 先頭ページに戻す。
     * 絞り込み条件を呼び出し側で持って reload() する場合、
     * 前の条件でのページ位置がそのまま残ってしまうので、あわせて呼ぶこと。
     */
    resetPage: () => setPage(1),
    setFilter: (filter: Partial<F>) => {
      if (filters) {
        setFilters({
          ...filters,
          ...filter,
        })
        setPage(1)
      }
    },
  }
}
export type PagingList = ReturnType<typeof usePagingList>
