'use client'

import { MultiButton } from '@/components/general/button'
import { CheckBoxCtrl } from '@/components/general/checkbox'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { MultiSelectCtrl } from '@/components/general/select'
import { CheckIcon, PencilSquareIcon, UserPlusIcon } from '@/components/icon'
import { InputCtrlPassword } from '@/components/input-ctrl-pw'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { ClientError } from '@/lib/error'
import { CreateUserIn, CreateUserOut, scCreateUser, scUpdateUser, UpdateUser } from '@/lib/schema/schema'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { createUser, updateUser } from './server'

export const AddModal: FC<ModalBaseProps & { enabledPassword: boolean; groupOptions: Record<string, string> }> = ({
  state,
  reload,
  enabledPassword,
  groupOptions,
}) => {
  const { t, fet } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<CreateUserIn, unknown, CreateUserOut>({
    resolver: zodResolver(scCreateUser),
    mode: 'onChange',
    defaultValues: {
      name: '',
      email: '',
      password: enabledPassword ? '' : undefined,
      isAdmin: false,
      groups: [],
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
      footer={
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
      <GridBox>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            name='name'
            constraintSchema={scCreateUser}
            label={t('username')}
            errorMessage={fet(errors.name)}
            autoFocus
          />
        </div>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            name='email'
            constraintSchema={scCreateUser}
            label={t('email')}
            errorMessage={fet(errors.email)}
          />
        </div>
        {enabledPassword && (
          <div className='col-span-12'>
            <InputCtrlPassword
              control={control}
              name='password'
              label={t('password')}
              autoComplete='new-password'
              errorMessage={fet(errors.password)}
              requiredPasswordScore={4}
              isRequired
            />
          </div>
        )}
        <div className='col-span-12 pb-4'>
          <CheckBoxCtrl control={control} name='isAdmin' id='isAdmin' label={t('is_admin')} />
        </div>
        <div className='col-span-12'>
          <MultiSelectCtrl control={control} name='groups' groupOptions={groupOptions} label={t('group')} />
        </div>
      </GridBox>
    </FormModal>
  )
}

export const UpdateModal: FC<ModalBaseProps & { target: UpdateUser; groupOptions: Record<string, string> }> = ({
  state,
  reload,
  target,
  groupOptions,
}) => {
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
      nameLocked: target.nameLocked,
      groups: target.groups,
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
          } else {
            throw e
          }
        }
      })}
      title={{ text: t('update_user'), icon: <PencilSquareIcon /> }}
      footer={
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
      <GridBox>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            name='name'
            constraintSchema={scUpdateUser}
            label={t('username')}
            errorMessage={fet(errors.name)}
            autoFocus
          />
        </div>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            name='email'
            constraintSchema={scUpdateUser}
            label={t('email')}
            errorMessage={fet(errors.email)}
          />
        </div>
        <div className='col-span-12 pb-4'>
          <CheckBoxCtrl control={control} name='isAdmin' id='isAdmin' label={t('is_admin')} />
        </div>
        <div className='col-span-12 pb-4'>
          <CheckBoxCtrl control={control} name='nameLocked' id='nameLocked' label={t('name_locked')} />
        </div>
        <div className='col-span-12'>
          <MultiSelectCtrl control={control} name='groups' groupOptions={groupOptions} label={t('group')} />
        </div>
      </GridBox>
    </FormModal>
  )
}
