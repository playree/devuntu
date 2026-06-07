'use client'

import { MultiButton } from '@/components/general/button'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input-ctrl'
import { CheckIcon, Cog6ToothIcon } from '@/components/icon'
import { InputCtrlPassword } from '@/components/input-ctrl-pw'
import { SingleLayout } from '@/components/single-layout'
import { parseAction } from '@/lib/action-client'
import { CreateAdmin, scCreateAdmin } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { createAdmin } from './server'

export const StartClient: FC<{ enabledPassword: boolean }> = ({ enabledPassword }) => {
  const { t, fet } = useLocale()
  const router = useRouter()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<CreateAdmin>({
    resolver: zodResolver(scCreateAdmin),
    mode: 'onChange',
    defaultValues: {
      name: '',
      email: '',
      password: enabledPassword ? '' : undefined,
    },
  })

  return (
    <SingleLayout icon={<Cog6ToothIcon />} title={t('admin_regist')}>
      <form
        onSubmit={handleSubmit(async (input) => {
          await parseAction(createAdmin(input))
          router.push('/')
        })}
      >
        <GridBox>
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
              autoComplete='email'
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
          <div className='col-span-12 mt-4 text-center'>
            <MultiButton type='submit' icon={<CheckIcon />} isPending={isSubmitting}>
              {t('ok')}
            </MultiButton>
          </div>
        </GridBox>
      </form>
    </SingleLayout>
  )
}
