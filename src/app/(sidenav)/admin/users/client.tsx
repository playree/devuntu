'use client'

import { usePageingList } from '@/components/general/paging'
import { ChevronUpIcon, UsersIcon } from '@/components/icon'
import { useLocale } from '@/locale/client'
import { cn, SortDescriptor, Table } from '@heroui/react'
import { FC, ReactNode } from 'react'
import { getUsers } from './server'

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

export const UsersClient: FC = () => {
  const { t } = useLocale()

  const list = usePageingList({
    load: async () => {
      const res = await getUsers()
      return res.data ?? []
    },
    sort: {
      init: { column: 'updatedAt', direction: 'descending' },
    },
  })

  return (
    <>
      <div className='flex justify-center gap-2 lg:justify-start'>
        <UsersIcon />
        {t('user_manage')}
      </div>

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label='users list' sortDescriptor={list.sortDescriptor} onSortChange={list.onSortChange}>
            <Table.Header>
              <Table.Column allowsSorting isRowHeader id='name'>
                {({ sortDirection }) => <SortableColumnHeader sortDirection={sortDirection}>Name</SortableColumnHeader>}
              </Table.Column>
            </Table.Header>
            <Table.Body>
              {list.items.map((item) => (
                <Table.Row key={item.name} id={item.name}>
                  <Table.Cell>{item.name}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </>
  )
}
