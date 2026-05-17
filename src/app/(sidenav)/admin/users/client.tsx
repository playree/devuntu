'use client'

import { usePageingList } from '@/components/general/paging'
import { ActionCell, MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, PencilSquareIcon, TrashIcon, UserPlusIcon, UsersIcon } from '@/components/icon'
import { parseAction } from '@/lib/action-client'
import { dayformat } from '@/lib/day'
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
          { id: 'name', name: t('username'), isRowHeader: true, allowsSorting: true, minWidth: 80 },
          { id: 'email', name: t('email'), allowsSorting: true, minWidth: 80 },
          { id: 'lastLoginAt', name: t('last_login'), allowsSorting: true, minWidth: 120 },
          { id: 'createdAt', name: t('created_at'), allowsSorting: true, minWidth: 120 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 120 },
        ]}
        paging={list}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell>{item.name}</Table.Cell>
            <Table.Cell className='truncate font-mono text-xs'>{item.email}</Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.lastLoginAt, 'jp-simple')}</Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.createdAt, 'jp-simple')}</Table.Cell>
            <ActionCell
              items={[
                { key: 'edit', icon: <PencilSquareIcon /> },
                {
                  key: 'delete',
                  variant: 'danger-soft',
                  icon: <TrashIcon />,
                },
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>
    </>
  )
}
