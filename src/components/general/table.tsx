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
import { Dispatch, FC, ReactNode, SetStateAction, SVGProps } from 'react'
import { type PagingList } from './paging'

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
      <Checkbox.Control className='size-5'>
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

type PagingParam = {
  rowsPerPage: number
  page: number
  total: number
  onPageChange: Dispatch<SetStateAction<number>>
}

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
  paging?: PagingParam
  isLoading?: boolean
  pagingList?: PagingList & { items: T[] }
  /** 行の上下パディングを詰めて、1 画面に表示できる行数を増やす */
  isCompact?: boolean
}

const TablePaging: FC<PagingParam> = ({ rowsPerPage, page, total, onPageChange }) => {
  const totalPages = Math.ceil(total / rowsPerPage)
  const start = (page - 1) * rowsPerPage + 1
  const end = Math.min(page * rowsPerPage, total)
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1)

  if (total === 0) {
    return (
      <Pagination size='sm'>
        <Pagination.Summary>0 results</Pagination.Summary>
      </Pagination>
    )
  }

  return (
    <Pagination size='sm'>
      <Pagination.Summary>
        {start} to {end} of {total} results
      </Pagination.Summary>
      <Pagination.Content>
        <Pagination.Item>
          <Pagination.Previous isDisabled={page === 1} onPress={() => onPageChange((p) => Math.max(1, p - 1))}>
            <Pagination.PreviousIcon />
            Prev
          </Pagination.Previous>
        </Pagination.Item>
        {pages.map((p) => (
          <Pagination.Item key={p}>
            <Pagination.Link isActive={p === page} onPress={() => onPageChange(p)}>
              {p}
            </Pagination.Link>
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
  paging,
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
  const pagingParam = paging ?? pagingList
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
        {pagingParam && <TablePaging {...pagingParam} />}
        <div className='absolute inset-0 z-10 flex items-center justify-center'>
          {pagingList?.isLoading && <Spinner />}
        </div>
      </Table.Footer>
    </Table>
  )
}
