'use client'

import { MultiButton } from '@/components/general/button'
import { InputCtrl } from '@/components/general/input-ctrl'
import { LocaleSwitch } from '@/components/general/locale-switch'
import { ThemeSwitchList } from '@/components/general/theme-switch'
import { CreateAdmin, scCreateAdmin } from '@/lib/schema'
import { gridStyles } from '@/lib/style'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { createAdmin } from './server'

export const StartClient: FC = () => {
  const { t } = useLocale()

  const { control, handleSubmit } = useForm<CreateAdmin>({
    defaultValues: {
      email: '',
    },
    resolver: zodResolver(scCreateAdmin),
  })

  return (
    <div className='mx-auto mt-4 w-full max-w-xl'>
      <div className='mb-4 flex items-center pl-8 lg:pl-0'>
        <span className='mr-8 text-lg'>{t('admin_regist')}</span>
        <div className='right-0 flex flex-auto justify-end'>
          <ThemeSwitchList size='sm' className='mr-2' />
          <LocaleSwitch size='sm' />
        </div>
      </div>

      <form
        onSubmit={handleSubmit(async (input) => {
          const res = await createAdmin(input)
          console.log(res)
        })}
      >
        <div className={gridStyles()}>
          <div className='col-span-12'>
            <InputCtrl control={control} name='email' label='email' autoComplete='email' isRequired />
          </div>
          <div className='col-span-12 mt-4 text-center'>
            <MultiButton type='submit'>test</MultiButton>
          </div>
        </div>
      </form>
    </div>
  )
}
