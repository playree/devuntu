'use client'

import { MultiButton } from '@/components/general/button'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input-ctrl'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { CheckIcon, PencilSquareIcon, PlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { CreateGroup, scCreateGroup, scUpdateGroup, UpdateGroup } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { createGroup, updateGroup } from './server'

export const AddModal: FC<ModalBaseProps> = ({ state, reload }) => {
  const { t, fet } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<CreateGroup>({
    resolver: zodResolver(scCreateGroup),
    mode: 'onChange',
    defaultValues: {
      name: '',
      description: '',
    },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        const res = await parseAction(createGroup(req))
        notify.success(t('msg_added_target', { target: res.name }))
        reload()
        state.close()
      })}
      title={{ text: t('add_group'), icon: <PlusIcon /> }}
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
            variant='secondary'
            name='name'
            constraintSchema={scCreateGroup}
            label={t('name')}
            errorMessage={fet(errors.name)}
            autoFocus
          />
        </div>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            variant='secondary'
            name='description'
            constraintSchema={scCreateGroup}
            label={t('description')}
            errorMessage={fet(errors.description)}
          />
        </div>
      </GridBox>
    </FormModal>
  )
}

export const UpdateModal: FC<ModalBaseProps & { target: UpdateGroup }> = ({ state, reload, target }) => {
  const { t, fet } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<UpdateGroup>({
    resolver: zodResolver(scUpdateGroup),
    mode: 'onChange',
    defaultValues: {
      id: target.id,
      name: target.name,
      description: target.description ?? '',
    },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        const res = await parseAction(updateGroup(req))
        notify.success(t('msg_updated_target', { target: res.name }))
        reload()
        state.close()
      })}
      title={{ text: t('update_group'), icon: <PencilSquareIcon /> }}
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
            variant='secondary'
            name='name'
            constraintSchema={scUpdateGroup}
            label={t('name')}
            errorMessage={fet(errors.name)}
            autoFocus
          />
        </div>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            variant='secondary'
            name='description'
            constraintSchema={scUpdateGroup}
            label={t('description')}
            errorMessage={fet(errors.description)}
          />
        </div>
      </GridBox>
    </FormModal>
  )
}
