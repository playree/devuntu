'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { usePagingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { FingerPrintIcon, PencilSquareIcon, PlusCircleIcon, TableCellsIcon, UserCircleIcon } from '@/components/icon'
import { authClient } from '@/lib/auth-client'
import { dayformat } from '@/lib/day'
import { envu } from '@/lib/env-util'
import { useLocale } from '@/locale/client'
import { Accordion, Table } from '@heroui/react'
import { FC } from 'react'

const MyPasskey: FC = () => {
  const { t } = useLocale()

  const list = usePagingList({
    load: async () => {
      const res = await authClient.passkey.listUserPasskeys()
      if (res.data) {
        return res.data.map(({ id, name, createdAt }) => ({
          id,
          name,
          createdAt,
        }))
      }
      return []
    },
    sort: {
      init: { column: 'createdAt', direction: 'descending' },
    },
  })

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center justify-between'>
        <div className='flex gap-1 pl-2'>
          <TableCellsIcon />
          {t('registered_passkeys')}
        </div>
        <MultiButton
          variant='ghost'
          size='sm'
          icon={<PlusCircleIcon />}
          onPress={async () => {
            const { data, error } = await authClient.passkey.addPasskey({
              name: envu.client.NEXT_PUBLIC_APP_NAME,
              authenticatorAttachment: 'platform',
            })
            console.debug('addPasskey', { data, error })
          }}
        >
          {t('register_passkey')}
        </MultiButton>
      </div>
      <MultiTable
        ariaLabel='passkey list'
        pagingList={list}
        columns={[
          {
            id: 'id',
            name: t('id'),
            isRowHeader: true,
            allowsSorting: true,
            minWidth: 120,
            defaultWidth: '1fr',
          },
          { id: 'name', name: t('name'), allowsSorting: true, minWidth: 200, defaultWidth: '2fr' },
          { id: 'createdAt', name: t('created_at'), allowsSorting: true, minWidth: 110 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 100 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell>{item.name}</Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.createdAt, 'jp-simple')}</Table.Cell>
            <ActionCell
              items={[
                {
                  template: 'none',
                  key: 'edit',
                  icon: <PencilSquareIcon />,
                  tooltip: t('update'),
                  onPress: () => {
                    // updateModalState.open(item)
                  },
                },
                {
                  template: 'delete',
                  target: item.name ?? '',
                  action: async () => {
                    // await parseAction(deleteOidcClient({ clientId: item.clientId }))
                    // notify.success(t('msg_deleted_target', { target: item.clientName }))
                    list.reload()
                  },
                },
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>
    </div>
  )
}

const defaultExpandedKeys = new Set(['passkey'])
export const AccountClient: FC = () => {
  const { t } = useLocale()

  return (
    <>
      <ContentHeader icon={<UserCircleIcon />} title={t('account')}></ContentHeader>
      <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedKeys}>
        <Accordion.Item id='passkey'>
          <Accordion.Heading>
            <Accordion.Trigger className='gap-1'>
              <FingerPrintIcon />
              {t('passkey')}
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className='px-4'>
              <MyPasskey />
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </>
  )
}
