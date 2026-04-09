'use client'

import { cn, type SortDescriptor, Table, type TableBodyProps, type TableContentProps } from '@heroui/react'
import { FC, ReactNode, SVGProps } from 'react'

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

export const MultiTable = <T extends object>({
  ariaLabel,
  sortDescriptor,
  onSortChange,
  columns,
  ...props
}: TableBodyProps<T> & {
  ariaLabel: string
  sortDescriptor?: TableContentProps['sortDescriptor']
  onSortChange?: TableContentProps['onSortChange']
  columns: {
    id: string
    name: string
    isRowHeader?: boolean
    allowsSorting?: boolean
  }[]
}) => {
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label={ariaLabel} sortDescriptor={sortDescriptor} onSortChange={onSortChange}>
          <Table.Header>
            {columns.map((column) => (
              <Table.Column
                allowsSorting={column.allowsSorting}
                isRowHeader={column.isRowHeader}
                id={column.id}
                key={column.id}
              >
                {({ sortDirection }) => (
                  <SortableColumnHeader sortDirection={sortDirection}>{column.name}</SortableColumnHeader>
                )}
              </Table.Column>
            ))}
          </Table.Header>
          <Table.Body {...props} />
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  )
}
