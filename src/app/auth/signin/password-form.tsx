'use client'

import { MultiButton } from '@/components/general/button'
import { StepMotion } from '@/components/general/step-motion'
import { ArrowLeftCircleIcon, ArrowLeftEndOnRectangleIcon, ShieldCheckIcon } from '@/components/icon'
import { InputPasswordCtrl } from '@/components/input-ctrl-pw'
import { notify } from '@/components/notify'
import { authClient } from '@/lib/auth/auth-client'
import { navigateAfterAuth } from '@/lib/client-utils'
import { scSignInPassword, SignInPassword } from '@/lib/schema/schema-auth'
import { intervalOperation } from '@/lib/sleep'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'

export type Mode = '2FA' | null

export const PasswordForm: FC<{
  direction: number
  email?: string
  callbackURL: string
  mode: Mode
  twoFaRequired: boolean
  next: (password: string) => void
  back: () => void
}> = ({ direction, email, callbackURL, mode, twoFaRequired, next, back }) => {
  const { t, fet } = useLocale()
  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<SignInPassword>({
    resolver: zodResolver(scSignInPassword),
    // mode: 'onChange',
    defaultValues: {
      password: '',
    },
  })

  return (
    <StepMotion direction={direction} className='mx-auto w-11/12 md:w-95'>
      <form
        onSubmit={handleSubmit(async (input) => {
          if (!email) {
            return
          }
          const { password } = input
          const res = await authClient.signIn.email(
            {
              email,
              password,
              rememberMe: true,
            },
            {
              onSuccess: async (ctx) => {
                if (ctx.data) {
                  const { user, twoFactorRedirect } = ctx.data
                  if (twoFactorRedirect) {
                    // 2FA
                    await authClient.twoFactor.sendOtp()
                    notify.success(t('msg_otp_sent'))
                    next(password)
                    return
                  }

                  if (!user) {
                    // 遷移も通知もしないまま画面が固まるのを避ける
                    notify.warn(t('auth_ng'))
                    return
                  }

                  // 2FA有効化の確認(運用として不要なら有効化もしない)
                  if (twoFaRequired && !user.twoFactorEnabled) {
                    await authClient.twoFactor.enable({ password })
                    await authClient.twoFactor.sendOtp()
                    notify.success(t('msg_otp_sent'))
                    next(password)
                    return
                  }

                  navigateAfterAuth(callbackURL)
                }
              },
            },
          )

          await intervalOperation()
          if (res.error) {
            console.debug(res.error)
            const msg = res.error.code === 'INVALID_EMAIL_OR_PASSWORD' ? t('msg_invalid_email_or_password') : undefined
            notify.warn(t('auth_ng'), { description: msg })
          }
        })}
      >
        <InputPasswordCtrl
          control={control}
          variant='secondary'
          name='password'
          label={t('password')}
          autoComplete='current-password'
          errorMessage={fet(errors.password)}
          autoFocus
        />
        <div className='flex items-center justify-between'>
          {mode === '2FA' ? (
            <div></div>
          ) : (
            <MultiButton
              variant='ghost'
              icon={<ArrowLeftCircleIcon />}
              onPress={() => {
                back()
              }}
            >
              {t('back')}
            </MultiButton>
          )}
          {mode === '2FA' ? (
            <MultiButton type='submit' icon={<ShieldCheckIcon />} isPending={isSubmitting}>
              {t('auth')}
            </MultiButton>
          ) : (
            <MultiButton type='submit' icon={<ArrowLeftEndOnRectangleIcon />} isPending={isSubmitting}>
              {t('signin')}
            </MultiButton>
          )}
        </div>
      </form>
    </StepMotion>
  )
}
