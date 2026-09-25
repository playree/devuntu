'use client'

import { Pagination } from '@heroui/react'
import { FC, useMemo } from 'react'
import { type PagingList } from './paging'
import { SingleSelectField } from './select'
import { useGeneralUiText } from './ui-text'
import { ROWS_PER_PAGE_OPTIONS } from './use-rows-per-page'

/** ページャの描画に必要な値。usePagingList の戻り値から導出して型ズレを防ぐ */
type PagingParam = Pick<
  PagingList,
  'rowsPerPage' | 'page' | 'total' | 'totalPages' | 'onPageChange' | 'onRowsPerPageChange'
>

/** 現在ページの前後に出すページ番号の数 */
const SIBLING_COUNT = 1

/**
 * 表示するページ番号。先頭・末尾・現在ページ周辺だけを残し、
 * 飛んだ箇所は null(= Pagination.Ellipsis)にする。
 * 例: page=5, totalPages=30 -> [1, null, 4, 5, 6, null, 30]
 */
const buildPageItems = (page: number, totalPages: number): (number | null)[] => {
  const shown = new Set<number>([1, totalPages])
  for (let p = page - SIBLING_COUNT; p <= page + SIBLING_COUNT; p++) {
    if (p >= 1 && p <= totalPages) {
      shown.add(p)
    }
  }
  const sorted = [...shown].sort((a, b) => a - b)
  return sorted.flatMap((p, i) => (i > 0 && p - sorted[i - 1] > 1 ? [null, p] : [p]))
}

/** 1ページあたりの表示件数を選ぶ。ページャの件数表示の隣に並べる */
const RowsPerPageSelect: FC<Pick<PagingParam, 'rowsPerPage' | 'onRowsPerPageChange'>> = ({
  rowsPerPage,
  onRowsPerPageChange,
}) => {
  const uiText = useGeneralUiText()
  const groupOptions = useMemo(
    () => Object.fromEntries(ROWS_PER_PAGE_OPTIONS.map((rows) => [String(rows), uiText.perPage(rows)])),
    [uiText],
  )
  return (
    <div // Select.Trigger は横幅いっぱいに広がるので、フッタでは幅を固定する
      className='w-28'
    >
      <SingleSelectField
        isSmart
        isLabelHidden
        variant='secondary'
        label={uiText.rowsPerPage}
        groupOptions={groupOptions}
        value={String(rowsPerPage)}
        onChange={(value) => {
          // isClearable を付けていないので null は来ないが、型の都合で除外する
          if (value) {
            onRowsPerPageChange(Number(value))
          }
        }}
      />
    </div>
  )
}

/** 一覧の下に出すページャ(件数表示 + 表示件数の選択 + ページ番号) */
export const TablePaging: FC<PagingParam> = ({
  rowsPerPage,
  page,
  total,
  totalPages,
  onPageChange,
  onRowsPerPageChange,
}) => {
  const uiText = useGeneralUiText()
  const start = (page - 1) * rowsPerPage + 1
  const end = Math.min(page * rowsPerPage, total)

  if (total === 0) {
    return (
      <Pagination size='sm'>
        <Pagination.Summary>
          <span>{uiText.noResults}</span>
          <RowsPerPageSelect rowsPerPage={rowsPerPage} onRowsPerPageChange={onRowsPerPageChange} />
        </Pagination.Summary>
      </Pagination>
    )
  }

  return (
    <Pagination size='sm'>
      <Pagination.Summary /* .pagination__summary が flex items-center gap-2 なので、子を並べるだけでよい */>
        <span>{uiText.resultRange(start, end, total)}</span>
        <RowsPerPageSelect rowsPerPage={rowsPerPage} onRowsPerPageChange={onRowsPerPageChange} />
      </Pagination.Summary>
      <Pagination.Content>
        <Pagination.Item>
          <Pagination.Previous isDisabled={page === 1} onPress={() => onPageChange((p) => Math.max(1, p - 1))}>
            <Pagination.PreviousIcon />
            {uiText.prev}
          </Pagination.Previous>
        </Pagination.Item>
        {buildPageItems(page, totalPages).map((p, i) => (
          <Pagination.Item key={p ?? `gap-${i}`}>
            {p === null ? (
              <Pagination.Ellipsis />
            ) : (
              <Pagination.Link isActive={p === page} onPress={() => onPageChange(p)}>
                {p}
              </Pagination.Link>
            )}
          </Pagination.Item>
        ))}
        <Pagination.Item>
          <Pagination.Next
            isDisabled={page === totalPages}
            onPress={() => onPageChange((p) => Math.min(totalPages, p + 1))}
          >
            {uiText.next}
            <Pagination.NextIcon />
          </Pagination.Next>
        </Pagination.Item>
      </Pagination.Content>
    </Pagination>
  )
}
