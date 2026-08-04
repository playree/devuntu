'use client'

import { SortDescriptor } from '@heroui/react'
import { AsyncListLoadFunction, useAsyncList } from '@react-stately/data'
import { Dispatch, SetStateAction, useEffect, useMemo, useRef, useState } from 'react'
import { getCookie, setCookie } from './cookie/client'

/** 表示件数の選択肢。ページャの Select と Cookie 値の検証で共有する */
export const ROWS_PER_PAGE_OPTIONS = [10, 20, 50, 100]

/**
 * 表示件数を保存する Cookie。
 * 一覧ごとではなくユーザーの好みとして扱うので、すべての一覧で同じ値を共有する
 */
const ROWS_PER_PAGE_COOKIE = 'rows-per-page'
const ROWS_PER_PAGE_COOKIE_MAX_AGE = 86400 * 365

/**
 * 表示件数の状態。クライアント側 / サーバー側ページングの両方で共有する。
 * 初期値は Cookie の前回の選択。アプリ全体が LocaleProvider の mounted 後に描画されるため
 * ハイドレーション不整合は起きない
 */
const useRowsPerPage = (fallback: number) => {
  const [rowsPerPage, setRowsPerPage] = useState(() => {
    const saved = Number(getCookie(ROWS_PER_PAGE_COOKIE))
    return ROWS_PER_PAGE_OPTIONS.includes(saved) ? saved : fallback
  })

  // 次回以降も同じ件数で開けるよう Cookie に残す
  const changeRowsPerPage = (rows: number) => {
    setRowsPerPage(rows)
    setCookie(ROWS_PER_PAGE_COOKIE, String(rows), { maxAge: ROWS_PER_PAGE_COOKIE_MAX_AGE, path: '/' })
  }

  return [rowsPerPage, changeRowsPerPage] as const
}

/**
 * 一覧の状態。usePagingList / useServerPagingList が同じ形で返すので、
 * MultiTable(table.tsx)はどちらの実装でもそのまま受け取れる
 */
export type PagingList<T extends Record<string, unknown> = Record<string, unknown>> = {
  /** 現在ページに表示する行 */
  items: T[]
  /** 絞り込み後の総件数(現在ページの件数ではない) */
  total: number
  totalPages: number
  page: number
  rowsPerPage: number
  sortDescriptor?: SortDescriptor
  onSortChange: (descriptor: SortDescriptor) => void
  onPageChange: Dispatch<SetStateAction<number>>
  onRowsPerPageChange: (rows: number) => void
  /** 同じ条件で取得し直す。現在のページ位置は維持する */
  reload: () => void
  isLoading: boolean
  /**
   * 先頭ページに戻す。
   * 絞り込み条件を呼び出し側で持って reload() する場合、
   * 前の条件でのページ位置がそのまま残ってしまうので、あわせて呼ぶこと。
   */
  resetPage: () => void
}

/** サーバー側ページングで 1 ページ分を取得するときの問い合わせ条件 */
export type PagingQuery = {
  page: number
  rowsPerPage: number
  /** 未指定 = サーバーの既定の並び順 */
  sortColumn?: string
  sortDirection?: 'ascending' | 'descending'
}

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

/**
 * クライアント側ページング。load が返した全件をメモリに持ち、ページ切り出しとソートを JS で行う。
 *
 * 総件数が数十件規模に収まる一覧向け。全件を返せない規模なら useServerPagingList を使う。
 */
export const usePagingList = <T extends Record<string, unknown>[], F extends Record<string, string>>({
  load,
  filter,
  sort,
  rowsPerPage: fallbackRowsPerPage = ROWS_PER_PAGE_OPTIONS[0],
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
  const [rowsPerPage, changeRowsPerPage] = useRowsPerPage(fallbackRowsPerPage)
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
    // 件数が変わると同じページ番号でも表示範囲がずれるので先頭ページへ戻す
    onRowsPerPageChange: (rows: number) => {
      changeRowsPerPage(rows)
      setPage(1)
    },
    reload: list.reload,
    isLoading: list.isLoading,
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

/**
 * サーバー側ページング。1 ページ分の行と絞り込み後の総件数だけを取得する。
 *
 * 全件をクライアントへ返せない規模の一覧(= 件数上限で打ち切ると
 * 上限を超えた行に到達できなくなる一覧)向け。ソートもサーバーに委ねるため、
 * loadPage は PagingQuery の並び順を必ず反映すること。
 *
 * 戻り値は usePagingList と同じ形なので MultiTable にそのまま渡せる。
 */
export const useServerPagingList = <T extends Record<string, unknown>>({
  loadPage,
  sort,
  rowsPerPage: fallbackRowsPerPage = ROWS_PER_PAGE_OPTIONS[0],
}: {
  loadPage: (query: PagingQuery) => Promise<{ items: T[]; total: number }>
  sort?: { init?: SortDescriptor }
  rowsPerPage?: number
}): PagingList<T> => {
  const [page, setPage] = useState(1)
  const [rowsPerPage, changeRowsPerPage] = useRowsPerPage(fallbackRowsPerPage)
  const [sortDescriptor, setSortDescriptor] = useState(sort?.init)
  // 条件が同じでも取得し直したいとき(reload)に進めるトークン
  const [reloadToken, setReloadToken] = useState(0)

  const sortColumn = sortDescriptor?.column === undefined ? undefined : String(sortDescriptor.column)
  const sortDirection = sortDescriptor?.direction

  /**
   * 取得条件の識別キー。取得済みの結果がどの条件のものかを表す。
   * これを保持している結果と比べることで、isLoading を state ではなく派生値にできる
   * (効果の中で同期的に setState せずに済む)
   */
  const queryKey = `${page}/${rowsPerPage}/${sortColumn}/${sortDirection}/${reloadToken}`

  // key は「まだ何も取得していない」ことを表すため、queryKey と一致しない値で初期化する
  const [loaded, setLoaded] = useState<{ key: string; items: T[]; total: number }>({
    key: '',
    items: [],
    total: 0,
  })
  const isLoading = loaded.key !== queryKey

  /**
   * loadPage はインライン関数で渡されることが多いため、常に最新のものを ref 経由で呼ぶ。
   * 取得のやり直しは page / rowsPerPage / 並び順 / reload だけを契機にしたいので、
   * loadPage 自体は下の効果の依存に入れない
   */
  const loadPageRef = useRef(loadPage)
  useEffect(() => {
    loadPageRef.current = loadPage
  })

  // 後着レスポンスで古いページを表示しないよう、最後に開始した取得だけを採用する
  const generation = useRef(0)

  useEffect(() => {
    const current = ++generation.current

    // 結果を差し替えるまで前のページの行を残す(表示が一瞬空になるのを避ける)
    loadPageRef
      .current({ page, rowsPerPage, sortColumn, sortDirection })
      .then((res) => {
        if (current !== generation.current) {
          return
        }
        /**
         * 削除などで総ページ数が減り、範囲外のページを要求していた場合の補正。
         * 取得前に丸めるとサーバーへ渡すページ番号と表示がずれるので、
         * 結果の総件数を見てから末尾ページで取り直す
         */
        const maxPage = Math.ceil(res.total / rowsPerPage) || 1
        if (page > maxPage) {
          setPage(maxPage)
          return
        }
        setLoaded({ key: queryKey, items: res.items, total: res.total })
      })
      .catch(() => {
        // エラー通知は loadPage 側(parseAction)が済ませているので、ここは表示を空にするだけ
        if (current === generation.current) {
          setLoaded({ key: queryKey, items: [], total: 0 })
        }
      })
  }, [queryKey, page, rowsPerPage, sortColumn, sortDirection])

  const totalPages = Math.ceil(loaded.total / rowsPerPage) || 1

  return {
    items: loaded.items,
    total: loaded.total,
    totalPages,
    page,
    rowsPerPage,
    sortDescriptor,
    // 並び順が変われば同じページ番号でも表示範囲が変わるので先頭ページへ戻す
    onSortChange: (descriptor) => {
      setSortDescriptor(descriptor)
      setPage(1)
    },
    onPageChange: setPage,
    onRowsPerPageChange: (rows) => {
      changeRowsPerPage(rows)
      setPage(1)
    },
    reload: () => setReloadToken((token) => token + 1),
    isLoading,
    resetPage: () => setPage(1),
  }
}
