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
    async load({ sortDescriptor, selectedKeys, signal }) {
      const items = await load()
      console.debug('sortDescriptor:', sortDescriptor)
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

  const { items, total } = useMemo(() => {
    console.debug('items update page:', page)

    // フィルタ
    const tmpList = filterState && filters ? list.items.filter((item) => filterState.proc(item, filters)) : list.items

    // ページング
    const start = (page - 1) * rowsPerPage
    const end = start + rowsPerPage

    return { items: tmpList.slice(start, end) as T, total: tmpList.length }
  }, [filterState, filters, list.items, page, rowsPerPage])

  const totalPages = useMemo(() => {
    return Math.ceil(total / rowsPerPage) || 1
  }, [total, rowsPerPage])

  return {
    items,
    total,
    totalPages,
    page,
    rowsPerPage,
    sortDescriptor: list.sortDescriptor,
    onSortChange: list.sort,
    onPageChange: setPage,
    reload: list.reload,
    isLoading: list.isLoading,
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
