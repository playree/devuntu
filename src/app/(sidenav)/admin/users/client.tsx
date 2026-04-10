'use client'

import { usePageingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { UsersIcon } from '@/components/icon'
import { gridStyles } from '@/lib/style'
import { useLocale } from '@/locale/client'
import { cn, Table } from '@heroui/react'
import { FC } from 'react'
import { getUsers } from './server'

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
    rowsPerPage: 4,
  })

  return (
    <>
      <div className={cn(gridStyles(), 'mb-4')}>
        <div className='col-span-12 flex justify-center gap-2 lg:col-span-6 lg:justify-start'>
          <UsersIcon />
          {t('user_manage')}
        </div>
      </div>

      <MultiTable
        ariaLabel='user list'
        items={list.items}
        sortDescriptor={list.sortDescriptor}
        onSortChange={list.onSortChange}
        columns={[
          { id: 'name', name: t('username'), isRowHeader: true, allowsSorting: true },
          { id: 'email', name: t('email'), isRowHeader: true, allowsSorting: true },
        ]}
        paging={{
          rowsPerPage: list.rowsPerPage,
          page: list.page,
          total: list.total,
          onPageChange: list.onPageChange,
        }}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell>{item.name}</Table.Cell>
            <Table.Cell>{item.email}</Table.Cell>
          </Table.Row>
        )}
      </MultiTable>
    </>
  )
}
