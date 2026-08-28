'use client'

import { MultiButton } from '@/components/general/button'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { CheckIcon, PencilSquareIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { authClient } from '@/lib/auth/auth-client'
import { scUpdatePasskey, UpdatePasskey } from '@/lib/schema/schema'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'

export const UpdatePasskeyModal: FC<ModalBaseProps & { target: UpdatePasskey }> = ({ state, reload, target }) => {
  const { t, fet } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<UpdatePasskey>({
    resolver: zodResolver(scUpdatePasskey),
    mode: 'onChange',
    defaultValues: {
      id: target.id,
      name: target.name,
    },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        const { data } = await authClient.passkey.updatePasskey({
          id: req.id,
          name: req.name,
        })
        if (data?.passkey) {
          notify.success(t('msg_updated_target', { target: req.name }))
          reload()
          state.close()
        }
      })}
      title={{ text: t('update_passkey'), icon: <PencilSquareIcon /> }}
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
            constraintSchema={scUpdatePasskey}
            label={t('name')}
            errorMessage={fet(errors.name)}
            autoFocus
          />
        </div>
      </GridBox>
    </FormModal>
  )
}
