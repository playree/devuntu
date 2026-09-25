'use client'

import { MultiButton } from '@/components/general/button'
import { CheckboxCtrl } from '@/components/general/checkbox'
import { InputOtpCtrl } from '@/components/general/input-otp'
import { StepMotion } from '@/components/general/step-motion'
import { ShieldCheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { authClient } from '@/lib/auth/auth-client'
import { navigateAfterAuth } from '@/lib/client-utils'
import { scTwoFaCode, TwoFaCode } from '@/lib/schema/schema-auth'
import { intervalOperation } from '@/lib/sleep'
import { textStyles } from '@/lib/style'
import { useLocale } from '@/locale/client'
import { cn } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC, useRef } from 'react'
import { useForm } from 'react-hook-form'

import { ResendOtpButton } from './resend-otp-button'

export const TwoFaForm: FC<{
  direction: number
  password?: string
  callbackURL: string
}> = ({ direction, password, callbackURL }) => {
  const { t } = useLocale()
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<TwoFaCode>({
    resolver: zodResolver(scTwoFaCode),
    // mode: 'onChange',
    defaultValues: {
      otp: '',
      trustDevice: true,
    },
  })
  const formRef = useRef<HTMLFormElement>(null)

  return (
    <StepMotion direction={direction} className='mx-auto w-11/12 md:w-95'>
      <form
        ref={formRef}
        onSubmit={handleSubmit(async (input) => {
          if (!password || !input.otp) {
            return
          }
          const res = await authClient.twoFactor.verifyOtp({
            code: input.otp,
            trustDevice: input.trustDevice,
          })
          await intervalOperation()
          if (res.error) {
            console.debug(res.error)
            notify.warn(t('auth_ng'))
            return
          }
          navigateAfterAuth(callbackURL)
        })}
      >
        <div className={cn(textStyles().light(), 'text-xs')}>{t('msg_enter_otp')}</div>
        <div>
          <InputOtpCtrl
            className='m-4'
            control={control}
            variant='secondary'
            name='otp'
            maxLength={6}
            autoComplete='one-time-code'
            inputMode='numeric'
            autoFocus
            onComplete={() => {
              formRef.current?.requestSubmit()
            }}
          />
        </div>
        <div className='mt-2 flex items-center justify-between'>
          <div>
            <CheckboxCtrl
              id='trustDevice'
              name='trustDevice'
              control={control}
              label={t('trust_device')}
              variant='secondary'
            />
          </div>
          <div className='flex gap-2'>
            <ResendOtpButton
              send={async () => {
                const res = await authClient.twoFactor.sendOtp()
                if (res.error?.code === 'INVALID_TWO_FACTOR_COOKIE') {
                  return 'expired'
                }
                return res.data?.status ? 'sent' : 'failed'
              }}
            />
            <MultiButton type='submit' icon={<ShieldCheckIcon />} isPending={isSubmitting}>
              {t('auth')}
            </MultiButton>
          </div>
        </div>
      </form>
    </StepMotion>
  )
}
