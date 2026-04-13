'use client'

import { MultiButton } from '@/components/general/button'
import { InputCtrl } from '@/components/general/input-ctrl'
import { CheckIcon, Cog6ToothIcon } from '@/components/icon'
import { InputCtrlPassword } from '@/components/input-ctrl-pw'
import { SingleLayout } from '@/components/single-layout'
import { makeUrl } from '@/lib/env-util'
import { CreateAdmin, scCreateAdmin } from '@/lib/schema'
import { intervalOperation } from '@/lib/sleep'
import { gridStyles } from '@/lib/style'
import { useLocale } from '@/locale/client'
import { toast } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { createAdmin } from './server'

export const StartClient: FC = () => {
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
      password: '',
    },
  })

  return (
    <SingleLayout icon={<Cog6ToothIcon />} title={t('admin_regist')}>
      <form
        onSubmit={handleSubmit(async (input) => {
          const res = await createAdmin(input)
          console.debug(res)
          if (!res.data) {
            toast.danger(t('error'), { description: t('msg_system_error') })
            return
          }

          await intervalOperation()
          router.push(makeUrl('/').toString())
        })}
      >
        <div className={gridStyles()}>
          <div className='col-span-12'>
            <InputCtrl
              control={control}
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
              name='email'
              label={t('email')}
              autoComplete='email'
              errorMessage={fet(errors.email)}
              isRequired
            />
          </div>
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
          <div className='col-span-12 mt-4 text-center'>
            <MultiButton type='submit' icon={<CheckIcon />} isPending={isSubmitting}>
              {t('ok')}
            </MultiButton>
          </div>
        </div>
      </form>
    </SingleLayout>
  )
}
