'use client'

import { MultiButton } from '@/components/general/button'
import { GrowMotion } from '@/components/general/grow-motion'
import { InputCtrl } from '@/components/general/input-ctrl'
import { CheckIcon, PaperAirplaneIcon, ShieldCheckIcon } from '@/components/icon'
import { SingleLayout } from '@/components/single-layout'
import { Step } from '@/components/step'
import { authClient } from '@/lib/auth-client'
import { TwoFACode, scTwoFACode } from '@/lib/schema'
import { gridStyles } from '@/lib/style'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { twMerge } from 'tailwind-merge'

export const TwoFARegistClient: FC = () => {
  const { data: session } = authClient.useSession()
  const { t, fet } = useLocale()
  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<TwoFACode>({
    resolver: zodResolver(scTwoFACode),
    // mode: 'onChange',
    defaultValues: {
      otp: '',
    },
  })

  return (
    <SingleLayout icon={<ShieldCheckIcon />} title={t('title_twofa_enable')}>
      <Step>Step1</Step>
      <div className={twMerge(gridStyles(), 'mb-2')}>
        <div className='col-span-9 flex h-full items-center pl-2'>
          {session?.user.email && (
            <GrowMotion key='view_email' className='truncate text-sm font-semibold text-gray-400'>
              {session.user.email}
            </GrowMotion>
          )}
        </div>
        <div className='col-span-3 flex justify-end'>
          <MultiButton startContent={<PaperAirplaneIcon />} isLoading={isSubmitting} onPress={() => {}}>
            {t('send')}
          </MultiButton>
        </div>
      </div>

      <Step>Step2</Step>
      <form>
        <InputCtrl
          control={control}
          name='otp'
          label={t('otp')}
          autoComplete='one-time-code'
          inputMode='numeric'
          errorMessage={fet(errors.otp)}
          isRequired
        />
        <div className='mt-4 flex items-center justify-end'>
          <MultiButton type='submit' startContent={<CheckIcon />} isLoading={isSubmitting}>
            {t('auth')}
          </MultiButton>
        </div>
      </form>
    </SingleLayout>
  )
}
