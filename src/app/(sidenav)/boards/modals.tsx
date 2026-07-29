'use client'

import { MultiButton } from '@/components/general/button'
import { CheckBoxCtrl } from '@/components/general/checkbox-ctrl'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input-ctrl'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { CheckIcon, PencilSquareIcon, PlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { CreateBoard, scCreateBoard, scUpdateBoard, UpdateBoard } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { createBoard, updateBoard } from './server'

export const AddModal: FC<ModalBaseProps> = ({ state, reload }) => {
  const { t, fet } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<CreateBoard>({
    resolver: zodResolver(scCreateBoard),
    mode: 'onChange',
    defaultValues: { name: '', description: '' },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        const res = await parseAction(createBoard(req))
        notify.success(t('msg_added_target', { target: res.name }))
        reload()
        state.close()
      })}
      title={{ text: t('add_board'), icon: <PlusIcon /> }}
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
            constraintSchema={scCreateBoard}
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
            constraintSchema={scCreateBoard}
            label={t('description')}
            errorMessage={fet(errors.description)}
          />
        </div>
      </GridBox>
    </FormModal>
  )
}

/** ボード更新。プライベートボードでは呼ばれない(呼び出し側で操作ボタンを出さない) */
export const UpdateModal: FC<ModalBaseProps & { target: UpdateBoard }> = ({ state, reload, target }) => {
  const { t, fet } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<UpdateBoard>({
    resolver: zodResolver(scUpdateBoard),
    mode: 'onChange',
    defaultValues: {
      id: target.id,
      name: target.name,
      description: target.description ?? '',
      archived: target.archived,
    },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        const res = await parseAction(updateBoard(req))
        notify.success(t('msg_updated_target', { target: res.name }))
        reload()
        state.close()
      })}
      title={{ text: t('update_board'), icon: <PencilSquareIcon /> }}
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
            constraintSchema={scUpdateBoard}
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
            constraintSchema={scUpdateBoard}
            label={t('description')}
            errorMessage={fet(errors.description)}
          />
        </div>
        <div className='col-span-12'>
          <CheckBoxCtrl control={control} variant='secondary' name='archived' id='archived' label={t('archived')} />
        </div>
      </GridBox>
    </FormModal>
  )
}
