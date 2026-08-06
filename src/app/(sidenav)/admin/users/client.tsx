'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { OnOffChip } from '@/components/general/chip'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { usePagingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, PencilSquareIcon, UserPlusIcon, UsersIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action-client'
import { dayformat } from '@/lib/day'
import { ClientError } from '@/lib/error'
import { UpdateUser } from '@/lib/schema'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { ButtonGroup, Chip, Table } from '@heroui/react'
import { FC } from 'react'
import { AddModal, UpdateModal } from './modals'
import { deleteUser, getGroupOptions, getUsers } from './server'

export const AdminUsersClient: FC<{ enabledPassword: boolean }> = ({ enabledPassword }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const addModalState = useModalState()
  const updateModalState = useModalState<UpdateUser>()
  const { data: groupOptions } = useActionData(getGroupOptions)

  const list = usePagingList({
    load: async () => {
      const res = await parseAction(getUsers())
      return res ?? []
    },
    sort: {
      init: { column: 'createdAt', direction: 'descending' },
    },
  })

  return (
    <FlexCol>
      <ContentHeader icon={<UsersIcon />} title={t('user_manage')}>
        <MultiButton isIconOnly tooltip={t('add_user')} onPress={() => addModalState.open()}>
          <UserPlusIcon />
        </MultiButton>
        <MultiButton isIconOnly tooltip={t('reload')} onPress={() => list.reload()}>
          <ButtonGroup.Separator />
          <ArrowPathIcon />
        </MultiButton>
      </ContentHeader>

      <MultiTable
        ariaLabel='user list'
        pagingList={list}
        columns={[
          { id: 'name', name: t('username'), isRowHeader: true, allowsSorting: true, minWidth: 80 },
          { id: 'email', name: t('email'), allowsSorting: true, minWidth: 80, defaultWidth: '1fr' },
          { id: 'isAdmin', name: t('is_admin'), allowsSorting: true, minWidth: 70, defaultWidth: 70 },
          { id: 'groups', name: t('group'), minWidth: 80, defaultWidth: '2fr' },
          { id: 'lastLoginAt', name: t('last_login'), allowsSorting: true, minWidth: 110 },
          { id: 'createdAt', name: t('created_at'), allowsSorting: true, minWidth: 110 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 100 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell>{item.name}</Table.Cell>
            <Table.Cell className='truncate font-mono text-xs'>{item.email}</Table.Cell>
            <Table.Cell>
              <OnOffChip isState={item.isAdmin} isIconOnly />
            </Table.Cell>
            <Table.Cell>
              <div className='flex flex-wrap gap-1'>
                {item.groups.map((group) => (
                  <Chip key={group.id} variant='soft' color='accent'>
                    {group.name}
                  </Chip>
                ))}
              </div>
            </Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.lastLoginAt, 'tz-simple', tz)}</Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.createdAt, 'tz-simple', tz)}</Table.Cell>
            <ActionCell
              items={[
                {
                  template: 'none',
                  key: 'edit',
                  icon: <PencilSquareIcon />,
                  tooltip: t('update'),
                  onPress: () => {
                    updateModalState.open({
                      id: item.id,
                      name: item.name,
                      email: item.email,
                      isAdmin: item.isAdmin,
                      groups: item.groups.map((group) => group.id),
                    })
                  },
                },
                {
                  template: 'delete',
                  target: item.name,
                  action: async () => {
                    try {
                      await parseAction(deleteUser({ id: item.id }))
                      notify.success(t('msg_deleted_target', { target: item.name }))
                      list.reload()
                    } catch (e) {
                      if (e instanceof ClientError && e.errorType === 'CANNOT_DELETE_LAST_ADMIN') {
                        notify.warn(t('msg_cannot_delete_last_admin'))
                      }
                    }
                  },
                },
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>

      {groupOptions && (
        <AddModal
          state={addModalState}
          reload={list.reload}
          key={addModalState.key}
          enabledPassword={enabledPassword}
          groupOptions={groupOptions}
        />
      )}
      {updateModalState.target && groupOptions && (
        <UpdateModal
          state={updateModalState}
          reload={list.reload}
          key={updateModalState.key}
          target={updateModalState.target}
          groupOptions={groupOptions}
        />
      )}
    </FlexCol>
  )
}
