'use client'

import {
  ButtonProps,
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
import { MultiButton } from './button'
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

type PagingParam = {
  rowsPerPage: number
  page: number
  total: number
  onPageChange: Dispatch<SetStateAction<number>>
}

type TableActivityProps<T> = {
  sortDescriptor?: TableContentProps['sortDescriptor']
  onSortChange?: TableContentProps['onSortChange']
  paging?: PagingParam
  isLoading?: boolean
  pagingList?: PagingList & { items: T[] }
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
  columns,
  paging,
  pagingList,
  items,
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
  return (
    <Table>
      <Table.ResizableContainer>
        <Table.Content
          aria-label={ariaLabel}
          sortDescriptor={sortDescriptor ?? pagingList?.sortDescriptor}
          onSortChange={onSortChange ?? pagingList?.onSortChange}
        >
          <Table.Header>
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

export const ActionCell: FC<{
  items: {
    key: string
    icon: ReactNode
    variant?: ButtonProps['variant']
    onPress?: () => void
  }[]
}> = ({ items }) => {
  return (
    <Table.Cell className='py-2'>
      <div className='flex items-center gap-0.5'>
        {items.map((item) => (
          <MultiButton
            key={item.key}
            variant={item.variant || 'tertiary'}
            onPress={item.onPress}
            isIconOnly
            size='sm'
            className='h-7 w-7 rounded-sm'
          >
            {item.icon}
          </MultiButton>
        ))}
      </div>
    </Table.Cell>
  )
}
