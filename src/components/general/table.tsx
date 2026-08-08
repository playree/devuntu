'use client'

import {
  Checkbox,
  cn,
  Pagination,
  type SortDescriptor,
  Spinner,
  Table,
  type TableBodyProps,
  TableColumnProps,
  type TableContentProps,
} from '@heroui/react'
import { FC, ReactNode, SVGProps } from 'react'
import { type PagingList, ROWS_PER_PAGE_OPTIONS } from './paging'
import { SingleSelectField } from './select'

const ChevronUpIcon: FC<SVGProps<SVGSVGElement>> = ({ width = 20, strokeWidth = 2, ...props }) => (
  <svg
    fill='currentColor'
    viewBox='0 0 24 24'
    xmlns='http://www.w3.org/2000/svg'
    aria-hidden='true'
    width={width}
    strokeWidth={strokeWidth}
    {...props}
  >
    <path
      clipRule='evenodd'
      fillRule='evenodd'
      d='M11.47 7.72a.75.75 0 0 1 1.06 0l7.5 7.5a.75.75 0 1 1-1.06 1.06L12 9.31l-6.97 6.97a.75.75 0 0 1-1.06-1.06l7.5-7.5Z'
    />
  </svg>
)

const SortableColumnHeader: FC<{
  children: React.ReactNode
  sortDirection?: 'ascending' | 'descending'
}> = ({ children, sortDirection }: { children: ReactNode; sortDirection?: SortDescriptor['direction'] }) => {
  return (
    <span className='flex items-center justify-between'>
      {children}
      {!!sortDirection && (
        <ChevronUpIcon
          className={cn(
            'size-3 transform transition-transform duration-100 ease-out',
            sortDirection === 'descending' ? 'rotate-180' : '',
          )}
        />
      )}
    </span>
  )
}

/**
 * 選択チェックボックス列の id と幅。ヘッダと SelectionCell で共有する。
 * 幅は左パディング(8px)+チェックボックス(size-5 = 20px)の最小値。
 * minWidth を渡さないと React Aria の既定最小幅(75px)に引き上げられるため、
 * Table.Column には width と minWidth の両方を指定すること。
 */
const SELECTION_COLUMN_ID = 'selection'
const SELECTION_COLUMN_WIDTH = 28
/** 既定の px-4 では余るので、選択列だけパディングを詰める */
const SELECTION_COLUMN_PADDING = 'pl-2 pr-0'

/**
 * isCompact のときの上下パディング。HeroUI 既定はセル px-4 py-3 / ヘッダ px-4 py-2.5。
 * 子孫セレクタなのでセル個別の className(py-2 など)より詳細度が高く、
 * SelectionCell や ActionCell の上下パディングもまとめて上書きされる。
 * MultiTable は仮想化しないので、セル / ヘッダは常に td / th としてレンダリングされる。
 */
const COMPACT_ROW_CLASS = '[&_td]:py-0.5 [&_th]:py-1'

/** 行選択のチェックボックス。ヘッダ(全選択)と各行で同じ見た目を使う */
const SelectionCheckbox: FC = () => (
  <Checkbox slot='selection' variant='secondary'>
    <Checkbox.Content>
      <Checkbox.Control // HeroUI v3 に radius prop が無いため className で丸型化。選択時の塗り(::before)も別途 rounded-md を持つので before: でも上書きする
        className='size-5 rounded-full before:rounded-full'
      >
        <Checkbox.Indicator />
      </Checkbox.Control>
    </Checkbox.Content>
  </Checkbox>
)

/**
 * 行選択チェックボックスのセル。
 * selectionBehavior='toggle' のとき、各行の先頭セルとして置く。
 */
export const SelectionCell: FC = () => (
  <Table.Cell className={cn('py-2', SELECTION_COLUMN_PADDING)}>
    <SelectionCheckbox />
  </Table.Cell>
)

/** ページャの描画に必要な値。usePagingList の戻り値から導出して型ズレを防ぐ */
type PagingParam = Pick<
  PagingList,
  'rowsPerPage' | 'page' | 'total' | 'totalPages' | 'onPageChange' | 'onRowsPerPageChange'
>

type TableActivityProps<T> = {
  sortDescriptor?: TableContentProps['sortDescriptor']
  onSortChange?: TableContentProps['onSortChange']
  /** 行選択。指定すると行クリックで選択できるようになる */
  selectionMode?: TableContentProps['selectionMode']
  /**
   * 選択方法。既定の 'replace' はチェックボックス列なしのハイライト選択。
   * 'toggle' にすると先頭にチェックボックス列が追加されるので、
   * 各行の先頭にも SelectionCell を置くこと。
   */
  selectionBehavior?: TableContentProps['selectionBehavior']
  selectedKeys?: TableContentProps['selectedKeys']
  onSelectionChange?: TableContentProps['onSelectionChange']
  pagingList?: PagingList & { items: T[] }
  /** 行の上下パディングを詰めて、1 画面に表示できる行数を増やす */
  isCompact?: boolean
}

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

/** 表示件数 Select の選択肢。Record<string, string> なので描画ごとに作らず定数にする */
const ROWS_PER_PAGE_GROUP = Object.fromEntries(ROWS_PER_PAGE_OPTIONS.map((rows) => [String(rows), `${rows} / page`]))

/** 1ページあたりの表示件数を選ぶ。ページャの件数表示の隣に並べる */
const RowsPerPageSelect: FC<Pick<PagingParam, 'rowsPerPage' | 'onRowsPerPageChange'>> = ({
  rowsPerPage,
  onRowsPerPageChange,
}) => (
  <div // Select.Trigger は横幅いっぱいに広がるので、フッタでは幅を固定する
    className='w-28'
  >
    <SingleSelectField
      isSmart
      isLabelHidden
      variant='secondary'
      // 共通部品なのでローカライズ不要とする
      label='rows per page'
      groupOptions={ROWS_PER_PAGE_GROUP}
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

const TablePaging: FC<PagingParam> = ({ rowsPerPage, page, total, totalPages, onPageChange, onRowsPerPageChange }) => {
  const start = (page - 1) * rowsPerPage + 1
  const end = Math.min(page * rowsPerPage, total)

  if (total === 0) {
    return (
      <Pagination size='sm'>
        <Pagination.Summary>
          <span>0 results</span>
          <RowsPerPageSelect rowsPerPage={rowsPerPage} onRowsPerPageChange={onRowsPerPageChange} />
        </Pagination.Summary>
      </Pagination>
    )
  }

  return (
    <Pagination size='sm'>
      <Pagination.Summary /* .pagination__summary が flex items-center gap-2 なので、子を並べるだけでよい */>
        <span>
          {start} to {end} of {total} results
        </span>
        <RowsPerPageSelect rowsPerPage={rowsPerPage} onRowsPerPageChange={onRowsPerPageChange} />
      </Pagination.Summary>
      <Pagination.Content>
        <Pagination.Item>
          <Pagination.Previous isDisabled={page === 1} onPress={() => onPageChange((p) => Math.max(1, p - 1))}>
            <Pagination.PreviousIcon />
            Prev
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
            Next
            <Pagination.NextIcon />
          </Pagination.Next>
        </Pagination.Item>
      </Pagination.Content>
    </Pagination>
  )
}

export const MultiTable = <T extends object>({
  ariaLabel,
  sortDescriptor,
  onSortChange,
  selectionMode,
  selectionBehavior,
  selectedKeys,
  onSelectionChange,
  columns,
  pagingList,
  items,
  isCompact,
  ...props
}: TableBodyProps<T> &
  TableActivityProps<T> & {
    ariaLabel: string
    columns: {
      id: string
      name: string
      isRowHeader?: boolean
      allowsSorting?: boolean
      minWidth?: number
      defaultWidth?: TableColumnProps['defaultWidth']
    }[]
  }) => {
  const behavior = selectionMode ? (selectionBehavior ?? 'replace') : undefined
  return (
    <Table className={cn(isCompact && COMPACT_ROW_CLASS)}>
      <Table.ResizableContainer>
        <Table.Content
          aria-label={ariaLabel}
          sortDescriptor={sortDescriptor ?? pagingList?.sortDescriptor}
          onSortChange={onSortChange ?? pagingList?.onSortChange}
          selectionMode={selectionMode}
          // 既定はクリックした行に選択を置き換える(トグルで解除されない)
          selectionBehavior={behavior}
          selectedKeys={selectedKeys}
          onSelectionChange={onSelectionChange}
        >
          <Table.Header>
            {behavior === 'toggle' && (
              <Table.Column
                id={SELECTION_COLUMN_ID}
                width={SELECTION_COLUMN_WIDTH}
                minWidth={SELECTION_COLUMN_WIDTH}
                className={SELECTION_COLUMN_PADDING}
              >
                {selectionMode === 'multiple' && (
                  <SelectionCheckbox /* 単一選択では全選択できないのでヘッダのチェックボックスは出さない */ />
                )}
              </Table.Column>
            )}
            {columns.map((column) => (
              <Table.Column
                allowsSorting={column.allowsSorting}
                isRowHeader={column.isRowHeader}
                id={column.id}
                key={column.id}
                minWidth={column.minWidth}
                defaultWidth={column.defaultWidth}
              >
                {({ sortDirection }) => (
                  <SortableColumnHeader sortDirection={sortDirection}>
                    {column.name}
                    {column.minWidth && <Table.ColumnResizer />}
                  </SortableColumnHeader>
                )}
              </Table.Column>
            ))}
          </Table.Header>
          <Table.Body {...props} items={items ?? pagingList?.items} />
        </Table.Content>
      </Table.ResizableContainer>
      <Table.Footer className='relative'>
        {pagingList && <TablePaging {...pagingList} />}
        {pagingList?.isLoading && (
          <div // inset-0 でフッタ全体を覆うため、pointer-events-none が無いとページャのクリックを奪ってしまう
            className='pointer-events-none absolute inset-0 z-10 flex items-center justify-center'
          >
            <Spinner />
          </div>
        )}
      </Table.Footer>
    </Table>
  )
}
