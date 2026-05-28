'use client'

import { MultiButton } from '@/components/general/button'
import { CheckBoxCtrl } from '@/components/general/checkbox-ctrl'
import { Grid } from '@/components/general/grid'
import { GrowMotion } from '@/components/general/grow-motion'
import { InputCtrl } from '@/components/general/input-ctrl'
import { InputOtpCtrl } from '@/components/general/input-otp-ctrl'
import { StepMotion } from '@/components/general/step-motion'
import {
  ArrowLeftCircleIcon,
  ArrowLeftEndOnRectangleIcon,
  ArrowPathIcon,
  ArrowRightCircleIcon,
  FingerPrintIcon,
  GoogleIcon,
  KeyIcon,
  ShieldCheckIcon,
} from '@/components/icon'
import { InputCtrlPassword } from '@/components/input-ctrl-pw'
import { notify } from '@/components/notify'
import { SingleLayout } from '@/components/single-layout'
import { parseAction } from '@/lib/action-client'
import { authClient } from '@/lib/auth-client'
import { authConfig } from '@/lib/auth-config'
import { envu, makeUrl } from '@/lib/env-util'
import {
  Otp,
  scOtp,
  scSignInPassword,
  scSignInUsername,
  scTwoFaCode,
  SignInPassword,
  SignInUsername,
  TwoFaCode,
} from '@/lib/schema'
import { intervalOperation } from '@/lib/sleep'
import { textStyles } from '@/lib/style'
import { useLocale } from '@/locale/client'
import { cn, Separator } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { AnimatePresence } from 'framer-motion'
import { useRouter, useSearchParams } from 'next/navigation'
import { FC, useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { getUserByEmail } from './server'

type Mode = '2FA' | null

type Step = {
  id: 'EMAIL' | 'PASSWORD' | 'OTP' | '2FA'
  direction: number
}

const UsernameForm: FC<{
  direction: number
  next: (email: string, nextStep: 'PASSWORD' | 'OTP') => void
}> = ({ direction, next }) => {
  const { t, fet } = useLocale()
  const searchParams = useSearchParams()
  const reAuthUser = searchParams.get('re')
  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<SignInUsername>({
    resolver: zodResolver(scSignInUsername),
    // mode: 'onChange',
    defaultValues: {
      username: reAuthUser ?? '',
    },
  })

  return (
    <StepMotion direction={direction} className='mx-auto w-11/12 md:w-95'>
      <form
        onSubmit={handleSubmit(async (input) => {
          const res = await parseAction(getUserByEmail(input))
          if (res?.next) {
            next(input.username, res.next)
          }
        })}
      >
        <InputCtrl
          control={control}
          variant='secondary'
          name='username'
          label={t('email')}
          autoComplete='username webauthn'
          errorMessage={fet(errors.username)}
          autoFocus
        />
        <div className='flex items-center justify-end'>
          <MultiButton type='submit' icon={<ArrowRightCircleIcon />} isPending={isSubmitting}>
            {t('next')}
          </MultiButton>
        </div>
      </form>
    </StepMotion>
  )
}

const PasswordForm: FC<{
  direction: number
  email?: string
  callbackURL: string
  mode: Mode
  next: (password: string) => void
  back: () => void
}> = ({ direction, email, callbackURL, mode, next, back }) => {
  const { t, fet } = useLocale()
  const router = useRouter()
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

                  if (user) {
                    // 2FA有効化の確認
                    if (!user.twoFactorEnabled) {
                      await authClient.twoFactor.enable({ password })
                      await authClient.twoFactor.sendOtp()
                      notify.success(t('msg_otp_sent'))
                      next(password)
                      return
                    }

                    router.push(callbackURL)
                  }
                }
              },
            },
          )
          console.debug(res)

          await intervalOperation()
          if (res.error) {
            console.debug(res.error)
            const msg = res.error.code === 'INVALID_EMAIL_OR_PASSWORD' ? t('msg_invalid_email_or_password') : undefined
            notify.warn(t('auth_ng'), { description: msg })
          }
        })}
      >
        <InputCtrlPassword
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

const OtpForm: FC<{
  direction: number
  email?: string
  callbackURL: string
  back: () => void
}> = ({ direction, email, callbackURL, back }) => {
  const { t } = useLocale()
  const router = useRouter()
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
          router.push(callbackURL)
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
            <MultiButton
              variant='ghost'
              icon={<ArrowPathIcon />}
              coolTime={30}
              onPress={async () => {
                if (!email) {
                  return
                }
                const res = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })
                console.log(res)
                if (!res.data?.success) {
                  // 一時的な認証状態が有効期限切れなので、サインインを最初からやり直す
                  window.location.reload()
                  return
                }
                notify.success(t('msg_otp_sent'))
              }}
            >
              {t('resend')}
            </MultiButton>
            <MultiButton type='submit' icon={<ShieldCheckIcon />} isPending={isSubmitting}>
              {t('auth')}
            </MultiButton>
          </div>
        </div>
      </form>
    </StepMotion>
  )
}

const TwoFaForm: FC<{
  direction: number
  password?: string
  callbackURL: string
}> = ({ direction, password, callbackURL }) => {
  const { t } = useLocale()
  const router = useRouter()
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
          router.push(callbackURL)
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
            <CheckBoxCtrl
              id='trustDevice'
              name='trustDevice'
              control={control}
              label={t('trust_device')}
              variant='secondary'
            />
          </div>
          <div className='flex gap-2'>
            <MultiButton
              variant='ghost'
              icon={<ArrowPathIcon />}
              coolTime={30}
              onPress={async () => {
                const res = await authClient.twoFactor.sendOtp()
                console.log(res)
                if (!res.data?.status) {
                  // 一時的な認証状態が有効期限切れなので、サインインを最初からやり直す
                  window.location.reload()
                  return
                }
                notify.success(t('msg_otp_sent'))
              }}
            >
              {t('resend')}
            </MultiButton>
            <MultiButton type='submit' icon={<ShieldCheckIcon />} isPending={isSubmitting}>
              {t('auth')}
            </MultiButton>
          </div>
        </div>
      </form>
    </StepMotion>
  )
}

export const SignInClient: FC<{ sessionEmail?: string }> = ({ sessionEmail }) => {
  const searchParams = useSearchParams()
  const { t } = useLocale()
  const router = useRouter()
  const [step, setStep] = useState<Step>(
    sessionEmail ? { id: 'PASSWORD', direction: 0 } : { id: 'EMAIL', direction: 0 },
  )
  const [email, setEmail] = useState(sessionEmail)
  const [password, setPassword] = useState<string>()

  const callbackURL = searchParams.get('cb') ?? envu.client.NEXT_PUBLIC_URL
  const mode = searchParams.get('mode') as Mode
  const errorCode = searchParams.get('error')
  const hasErrorToasted = useRef(false)

  useEffect(() => {
    if (errorCode && !hasErrorToasted.current) {
      let msg
      switch (errorCode) {
        case 'user_not_exist':
          msg = t('msg_user_not_exist')
          break
        case 'account_not_linked':
          msg = t('msg_email_not_verified')
          break
      }
      notify.warn(t('auth_ng'), { description: msg })
      hasErrorToasted.current = true
    }
  }, [errorCode, t])

  const viewTitle = useMemo(() => {
    if (mode === '2FA') {
      return t('twofa_enable')
    }
    if (step.id === '2FA') {
      return t('twofa')
    }
    return t('signin')
  }, [mode, step, t])

  return (
    <SingleLayout icon={<KeyIcon />} title={viewTitle}>
      <Grid className='mb-4'>
        <div className='col-span-12 flex md:col-span-3'>
          <div className='text-lg'>{t('welcome')}</div>
        </div>
        <div className='col-span-12 min-h-5 md:col-span-9'>
          {email && (
            <div className='flex h-full w-full items-end'>
              <GrowMotion key='view_email' className='truncate text-sm font-semibold text-gray-400'>
                {email}
              </GrowMotion>
            </div>
          )}
        </div>
      </Grid>

      <div className='min-h-32 overflow-hidden'>
        <AnimatePresence mode='wait' custom={step.direction}>
          {step.id === 'EMAIL' && (
            <UsernameForm
              key='step_email'
              direction={step.direction}
              next={(email, nextStep) => {
                setStep({ id: nextStep, direction: 1 })
                setEmail(email)
              }}
            />
          )}

          {step.id === 'PASSWORD' && (
            <PasswordForm
              key='step_password'
              direction={step.direction}
              email={email}
              mode={mode}
              callbackURL={callbackURL}
              next={(password) => {
                setPassword(password)
                setStep({ id: '2FA', direction: 1 })
              }}
              back={() => {
                setStep({ id: 'EMAIL', direction: -1 })
                setEmail(undefined)
              }}
            />
          )}

          {step.id === 'OTP' && (
            <OtpForm
              key='step_otp'
              direction={step.direction}
              email={email}
              callbackURL={callbackURL}
              back={() => {
                setStep({ id: 'EMAIL', direction: -1 })
                setEmail(undefined)
              }}
            />
          )}

          {step.id === '2FA' && (
            <TwoFaForm key='step_2fa' direction={step.direction} password={password} callbackURL={callbackURL} />
          )}
        </AnimatePresence>
      </div>

      {mode !== '2FA' && (
        <>
          <div className='mt-6 mb-4 flex items-center'>
            <Separator className='flex-1' />
            <div className={cn(textStyles().superlight(), 'mx-2')}>or</div>
            <Separator className='flex-1' />
          </div>
          <MultiButton
            className='mx-auto mt-2 max-w-xs'
            fullWidth
            variant='tertiary'
            icon={<GoogleIcon />}
            onPress={async () => {
              const data = await authClient.signIn.social({
                provider: 'google',
                callbackURL,
                errorCallbackURL: makeUrl(authConfig.path.signIn, { cb: callbackURL }).toString(),
              })
              console.log(data)
            }}
          >
            {t('google_signin')}
          </MultiButton>
          <MultiButton
            className='mx-auto mt-2 max-w-xs'
            fullWidth
            variant='tertiary'
            icon={<FingerPrintIcon />}
            onPress={async () => {
              const { data, error } = await authClient.signIn.passkey()
              console.debug('passkey', { data, error })
              if (error) {
                notify.warn(t('auth_ng'))
                return
              }
              router.push(callbackURL)
            }}
          >
            {t('passkey_signin')}
          </MultiButton>
        </>
      )}
    </SingleLayout>
  )
}
