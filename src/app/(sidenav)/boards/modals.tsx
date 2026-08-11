'use client'

import { MultiButton } from '@/components/general/button'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { CheckIcon, PlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { ClientError } from '@/lib/error'
import { CreateBoard, scCreateBoard } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { createBoard } from './server'

export const AddModal: FC<ModalBaseProps> = ({ state, reload }) => {
  const { t, fet } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<CreateBoard>({
    resolver: zodResolver(scCreateBoard),
    mode: 'onChange',
    defaultValues: { name: '', key: '', description: '' },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        try {
          const res = await parseAction(createBoard(req))
          notify.success(t('msg_added_target', { target: res.name }))
          reload()
          state.close()
        } catch (e) {
          // キーは全ボードで一意。他のボードが使っている場合は入力し直してもらう
          if (e instanceof ClientError && e.errorType === 'DUPLICATED_BOARD_KEY') {
            notify.warn(t('msg_duplicated_board_key'))
          } else {
            throw e
          }
        }
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
            name='key'
            constraintSchema={scCreateBoard}
            label={t('board_key')}
            placeholder='DEV'
            errorMessage={fet(errors.key)}
            // 入力は小文字でも zBoardKey が大文字へ寄せるので、見た目も大文字に揃えておく
            className='font-mono uppercase'
          />
        </div>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
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
