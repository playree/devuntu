'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { CheckBoxCtrl } from '@/components/general/checkbox-ctrl'
import { OnOffChip } from '@/components/general/chip'
import { InputCtrl } from '@/components/general/input-ctrl'
import { FormModal, ModalBaseProps, useModalState } from '@/components/general/modal'
import { usePagingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, CheckIcon, PencilSquareIcon, UserIcon, UserPlusIcon, UsersIcon } from '@/components/icon'
import { InputCtrlPassword } from '@/components/input-ctrl-pw'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { dayformat } from '@/lib/day'
import { ClientError } from '@/lib/error'
import { CreateUser, scCreateUser, scUpdateUser, UpdateUser } from '@/lib/schema'
import { gridStyles } from '@/lib/style'
import { useLocale } from '@/locale/client'
import { ButtonGroup, cn, Table } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { createUser, deleteUser, getUsers, updateUser } from './server'

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

const UpdateModal: FC<ModalBaseProps & { target: UpdateUser }> = ({ state, reload, target }) => {
  const { t, fet } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<UpdateUser>({
    resolver: zodResolver(scUpdateUser),
    mode: 'onChange',
    defaultValues: {
      id: target.id,
      name: target.name,
      email: target.email,
      isAdmin: target.isAdmin,
    },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        try {
          await parseAction(updateUser(req))
          notify.success(t('msg_updated_target', { target: req.name }))
          reload()
          state.close()
        } catch (e) {
          if (e instanceof ClientError && e.errorType === 'CANNOT_DELETE_LAST_ADMIN') {
            notify.warn(t('msg_cannot_delete_last_admin'))
          }
        }
      })}
      title={{ text: t('update_user'), icon: <UserIcon /> }}
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
  const updateModalState = useModalState<UpdateUser>()

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
          { id: 'email', name: t('email'), allowsSorting: true, minWidth: 80, defaultWidth: '2fr' },
          { id: 'isAdmin', name: t('is_admin'), allowsSorting: true, minWidth: 70 },
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
            <Table.Cell className='font-mono text-xs'>{dayformat(item.lastLoginAt, 'jp-simple')}</Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.createdAt, 'jp-simple')}</Table.Cell>
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

      <AddModal state={addModalState} reload={list.reload} key={addModalState.key} enabledPassword={enabledPassword} />
      {updateModalState.target && (
        <UpdateModal
          state={updateModalState}
          reload={list.reload}
          key={updateModalState.key}
          target={updateModalState.target}
        />
      )}
    </>
  )
}
