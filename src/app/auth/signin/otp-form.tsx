'use client'

import { MultiButton } from '@/components/general/button'
import { InputOtpCtrl } from '@/components/general/input-otp'
import { StepMotion } from '@/components/general/step-motion'
import { ArrowLeftCircleIcon, ShieldCheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { authClient } from '@/lib/auth/auth-client'
import { navigateAfterAuth } from '@/lib/client-utils'
import { Otp, scOtp } from '@/lib/schema/schema-auth'
import { intervalOperation } from '@/lib/sleep'
import { textStyles } from '@/lib/style'
import { useLocale } from '@/locale/client'
import { cn } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC, useRef } from 'react'
import { useForm } from 'react-hook-form'

import { ResendOtpButton } from './resend-otp-button'

export const OtpForm: FC<{
  direction: number
  email?: string
  callbackURL: string
  back: () => void
}> = ({ direction, email, callbackURL, back }) => {
  const { t } = useLocale()
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<Otp>({
    resolver: zodResolver(scOtp),
    // mode: 'onChange',
    defaultValues: {
      otp: '',
    },
  })
  const formRef = useRef<HTMLFormElement>(null)

  return (
    <StepMotion direction={direction} className='mx-auto w-11/12 md:w-95'>
      <form
        ref={formRef}
        onSubmit={handleSubmit(async ({ otp }) => {
          if (!otp) {
            return
          }
          const res = await authClient.signIn.emailOtp({ email, otp })
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
            <MultiButton
              variant='ghost'
              icon={<ArrowLeftCircleIcon />}
              onPress={() => {
                back()
              }}
            >
              {t('back')}
            </MultiButton>
          </div>
          <div className='flex gap-2'>
            <ResendOtpButton
              send={async () => {
                if (!email) {
                  return null
                }
                const res = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })
                // メールアドレスは画面側で持っているので、失敗しても最初からやり直す必要は無い
                return res.data?.success ? 'sent' : 'failed'
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
