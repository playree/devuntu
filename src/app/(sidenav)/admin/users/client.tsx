'use client'

import { usePageingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, UserPlusIcon, UsersIcon } from '@/components/icon'
import { parseAction } from '@/lib/action-client'
import { useLocale } from '@/locale/client'
import { Button, ButtonGroup, Table } from '@heroui/react'
import { FC } from 'react'
import { getUsers } from './server'

export const UsersClient: FC = () => {
  const { t } = useLocale()

  const list = usePageingList({
    load: async () => {
      const res = await parseAction(getUsers())
      return res ?? []
    },
    sort: {
      init: { column: 'updatedAt', direction: 'descending' },
    },
  })

  return (
    <>
      <ContentHeader icon={<UsersIcon />} title={t('user_manage')}>
        <Button isIconOnly>
          <UserPlusIcon />
        </Button>
        <Button isIconOnly>
          <ButtonGroup.Separator />
          <ArrowPathIcon />
        </Button>
      </ContentHeader>

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
