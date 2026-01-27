'use client'

import { MultiButton } from '@/components/general/button'
import { InputCtrl } from '@/components/general/input-ctrl'
import { LocaleSwitch } from '@/components/general/locale-switch'
import { ThemeSwitchList } from '@/components/general/theme-switch'
import { CheckIcon, Cog6ToothIcon } from '@/components/icon'
import { CreateAdmin, scCreateAdmin } from '@/lib/schema'
import { intervalOperation } from '@/lib/sleep'
import { gridStyles } from '@/lib/style'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { createAdmin } from './server'

export const StartClient: FC = () => {
  const { t, fet } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<CreateAdmin>({
    resolver: zodResolver(scCreateAdmin),
    mode: 'onChange',
    defaultValues: {
      email: '',
    },
  })

  return (
    <div className='mx-auto mt-4 w-full max-w-xl'>
      <div className='mb-4 flex items-center pl-8 lg:pl-0'>
        <Cog6ToothIcon className='mr-2' />
        <span className='mr-8 text-lg'>{t('title_admin_regist')}</span>
        <div className='right-0 flex flex-auto justify-end'>
          <ThemeSwitchList size='sm' className='mr-2' />
          <LocaleSwitch size='sm' />
        </div>
      </div>

      <form
        onSubmit={handleSubmit(async (input) => {
          const res = await createAdmin(input)
          console.log(res)
          await intervalOperation()
        })}
      >
        <div className={gridStyles()}>
          <div className='col-span-12'>
            <InputCtrl
              control={control}
              name='email'
              label={t('email')}
              autoComplete='email'
              errorMessage={fet(errors.email)}
              isRequired
            />
          </div>
          <div className='col-span-12 mt-4 text-center'>
            <MultiButton type='submit' startContent={<CheckIcon />} isLoading={isSubmitting}>
              {t('ok')}
            </MultiButton>
          </div>
        </div>
      </form>
    </div>
  )
}
