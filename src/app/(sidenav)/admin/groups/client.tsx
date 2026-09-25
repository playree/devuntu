'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { usePagingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { PencilSquareIcon, PlusIcon, UserGroupIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { ReloadButton } from '@/components/reload-button'
import { parseAction } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { UpdateGroup } from '@/lib/schema/schema-admin'
import { useLocale } from '@/locale/client'
import { Table } from '@heroui/react'
import { FC } from 'react'
import { AddModal, UpdateModal } from './modals'
import { deleteGroup, getGroups } from './server'

export const AdminGroupsClient: FC = () => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const addModalState = useModalState()
  const updateModalState = useModalState<UpdateGroup>()

  const list = usePagingList({
    load: async () => {
      const res = await parseAction(getGroups())
      return res ?? []
    },
    sort: {
      init: { column: 'createdAt', direction: 'descending' },
    },
  })

  return (
    <FlexCol>
      <ContentHeader icon={<UserGroupIcon />} title={t('group_manage')}>
        <MultiButton isIconOnly tooltip={t('add_group')} icon={<PlusIcon />} onPress={() => addModalState.open()} />
        <ReloadButton onReload={list.reload} />
      </ContentHeader>

      <MultiTable
        isSmart
        aria-label='group list'
        pagingList={list}
        columns={[
          { id: 'name', name: t('name'), isRowHeader: true, allowsSorting: true, minWidth: 80 },
          { id: 'description', name: t('description'), allowsSorting: true, minWidth: 80, defaultWidth: '2fr' },
          { id: 'createdAt', name: t('created_at'), allowsSorting: true, minWidth: 110 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 100 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell>{item.name}</Table.Cell>
            <Table.Cell className='truncate'>{item.description}</Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.createdAt, 'tz-minute', tz)}</Table.Cell>
            <ActionCell
              items={[
                {
                  template: 'none',
                  key: 'edit',
                  icon: <PencilSquareIcon />,
                  tooltip: t('update'),
                  onPress: () => {
                    updateModalState.open(item)
                  },
                },
                {
                  template: 'delete',
                  target: item.name,
                  action: async () => {
                    await parseAction(deleteGroup({ id: item.id }))
                    notify.success(t('msg_deleted_target', { target: item.name }))
                    list.reload()
                  },
                },
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>

      <AddModal state={addModalState} reload={list.reload} key={addModalState.key} />
      {updateModalState.target && (
        <UpdateModal
          state={updateModalState}
          reload={list.reload}
          key={updateModalState.key}
          target={updateModalState.target}
        />
      )}
    </FlexCol>
  )
}
