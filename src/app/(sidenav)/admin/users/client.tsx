'use client'

import { MultiButton } from '@/components/general/button'
import { CheckBoxCtrl } from '@/components/general/checkbox-ctrl'
import { OnOffChip } from '@/components/general/chip'
import { InputCtrl } from '@/components/general/input-ctrl'
import { FormModal, ModalBaseProps, useConfirmModal, useModalState } from '@/components/general/modal'
import { usePagingList } from '@/components/general/paging'
import { ActionCell, MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, CheckIcon, PencilSquareIcon, TrashIcon, UserPlusIcon, UsersIcon } from '@/components/icon'
import { InputCtrlPassword } from '@/components/input-ctrl-pw'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { dayformat } from '@/lib/day'
import { CreateUser, scCreateUser } from '@/lib/schema'
import { gridStyles } from '@/lib/style'
import { useLocale } from '@/locale/client'
import { ButtonGroup, cn, Table } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { createUser, deleteUser, getUsers } from './server'

const AddModal: FC<ModalBaseProps & { enabledPassword: boolean }> = ({ state, reload, enabledPassword }) => {
  const { t, fet } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<CreateUser>({
    resolver: zodResolver(scCreateUser),
    mode: 'onChange',
    defaultValues: {
      name: '',
      email: '',
      password: enabledPassword ? '' : undefined,
      isAdmin: false,
    },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        const res = await parseAction(createUser(req))
        notify.success(t('msg_added_target', { target: res.name }))
        reload()
        state.close()
      })}
      title={{ text: t('add_user'), icon: <UserPlusIcon /> }}
      hooter={
        <>
          <MultiButton slot='close' variant='ghost'>
            {t('cancel')}
          </MultiButton>
          <MultiButton type='submit' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('ok')}
          </MultiButton>
        </>
      }
    >
      <div className={cn(gridStyles(), 'mt-4 p-1')}>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            variant='secondary'
            name='name'
            label={t('username')}
            errorMessage={fet(errors.name)}
            isRequired
            autoFocus
          />
        </div>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            variant='secondary'
            name='email'
            label={t('email')}
            errorMessage={fet(errors.email)}
            isRequired
          />
        </div>
        {enabledPassword && (
          <div className='col-span-12'>
            <InputCtrlPassword
              control={control}
              variant='secondary'
              name='password'
              label={t('password')}
              autoComplete='new-password'
              errorMessage={fet(errors.password)}
              requiredPasswordScore={4}
              isRequired
            />
          </div>
        )}
        <div className='col-span-12'>
          <CheckBoxCtrl control={control} variant='secondary' name='isAdmin' id='isAdmin' label={t('is_admin')} />
        </div>
      </div>
    </FormModal>
  )
}

export const UsersClient: FC<{ enabledPassword: boolean }> = ({ enabledPassword }) => {
  const { t } = useLocale()
  const addModalState = useModalState()
  const { confirmModal } = useConfirmModal()

  const list = usePagingList({
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
        <MultiButton isIconOnly tooltip={t('add_user')} onPress={addModalState.open}>
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
          { id: 'email', name: t('email'), allowsSorting: true, minWidth: 80 },
          { id: 'isAdmin', name: t('is_admin'), allowsSorting: true, minWidth: 110 },
          { id: 'lastLoginAt', name: t('last_login'), allowsSorting: true, minWidth: 120 },
          { id: 'createdAt', name: t('created_at'), allowsSorting: true, minWidth: 120 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 120 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell>{item.name}</Table.Cell>
            <Table.Cell className='truncate font-mono text-xs'>{item.email}</Table.Cell>
            <Table.Cell>
              <OnOffChip isState={item.isAdmin} />
            </Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.lastLoginAt, 'jp-simple')}</Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.createdAt, 'jp-simple')}</Table.Cell>
            <ActionCell
              items={[
                { key: 'edit', icon: <PencilSquareIcon />, tooltip: t('edit') },
                {
                  key: 'delete',
                  variant: 'danger-soft',
                  icon: <TrashIcon />,
                  tooltip: t('delete'),
                  onPress: async () => {
                    try {
                      const ok = await confirmModal().confirm({
                        title: t('confirm_deletion'),
                        text: t('msg_confirm_deletion', { target: item.name }),
                        requireCheck: true,
                        autoClose: false,
                      })
                      if (ok) {
                        await parseAction(deleteUser({ id: item.id }))
                        notify.success(t('msg_deleted_target', { target: item.name }))
                        list.reload()
                      }
                    } finally {
                      confirmModal().close()
                    }
                  },
                },
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>

      <AddModal state={addModalState} reload={list.reload} key={addModalState.key} enabledPassword={enabledPassword} />
    </>
  )
}
