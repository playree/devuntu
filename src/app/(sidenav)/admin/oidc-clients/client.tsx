'use client'

import { usePageingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, UserPlusIcon, UsersIcon } from '@/components/icon'
import { useLocale } from '@/locale/client'
import { Button, ButtonGroup, Table } from '@heroui/react'
import { FC } from 'react'
import { getOAuthClients } from './server'

export const OidcListClient: FC = () => {
  const { t } = useLocale()

  const list = usePageingList({
    load: async () => {
      const res = await getOAuthClients()
      return res.data ?? []
    },
    sort: {
      init: { column: 'updatedAt', direction: 'descending' },
    },
    rowsPerPage: 4,
  })

  return (
    <>
      <ContentHeader icon={<UsersIcon />} title={t('oidc_clients')}>
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
          { id: 'name', name: 'client_name', isRowHeader: true, allowsSorting: true },
          { id: 'email', name: 'client_id', isRowHeader: true, allowsSorting: true },
        ]}
        paging={{
          rowsPerPage: list.rowsPerPage,
          page: list.page,
          total: list.total,
          onPageChange: list.onPageChange,
        }}
      >
        {(item) => (
          <Table.Row key={item.client_id} id={item.client_id}>
            <Table.Cell>{item.client_name}</Table.Cell>
            <Table.Cell>{item.client_id}</Table.Cell>
          </Table.Row>
        )}
      </MultiTable>
    </>
  )
}
