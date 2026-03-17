'use client'

import { MultiButton } from '@/components/general/button'
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
import { SingleLayout } from '@/components/single-layout'
import { authClient } from '@/lib/auth-client'
import { authConfig } from '@/lib/auth-config'
import { envu, makeUrl } from '@/lib/env-util'
import {
  scSignInPassword,
  scSignInUsername,
  scTwoFaCode,
  SignInPassword,
  SignInUsername,
  TwoFaCode,
} from '@/lib/schema'
import { intervalOperation } from '@/lib/sleep'
import { gridStyles, textStyles } from '@/lib/style'
import { useLocale } from '@/locale/client'
import { addToast, Divider } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { AnimatePresence } from 'framer-motion'
import { useRouter, useSearchParams } from 'next/navigation'
import { FC, useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { twMerge } from 'tailwind-merge'
import { getUserByEmail } from './server'

type Mode = '2FA' | null

const UsernameForm: FC<{
  direction: number
  next: (email: string) => void
}> = ({ direction, next }) => {
  const { t, fet } = useLocale()
  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<SignInUsername>({
    resolver: zodResolver(scSignInUsername),
    // mode: 'onChange',
    defaultValues: {
      username: '',
    },
  })

  // const isLoadedPasskey = useRef(false)
  // useEffect(() => {
  //   if (
  //     isLoadedPasskey.current ||
  //     !PublicKeyCredential.isConditionalMediationAvailable ||
  //     !PublicKeyCredential.isConditionalMediationAvailable()
  //   ) {
  //     return
  //   }
  //   isLoadedPasskey.current = true
  //   void authClient.signIn.passkey({ autoFill: true })
  // }, [])

  return (
    <StepMotion direction={direction}>
      <form
        onSubmit={handleSubmit(async (input) => {
          await getUserByEmail(input)
          await intervalOperation(100)
          next(input.username)
        })}
      >
        <InputCtrl
          control={control}
          name='username'
          label={t('email')}
          autoComplete='username webauthn'
          errorMessage={fet(errors.username)}
          isRequired
          autoFocus
        />
        <div className='flex items-center justify-end'>
          <MultiButton type='submit' startContent={<ArrowRightCircleIcon />} isLoading={isSubmitting}>
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
    <StepMotion direction={direction}>
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
                    addToast({ title: t('msg_otp_sent'), color: 'success' })
                    next(password)
                    return
                  }

                  if (user) {
                    // 2FA有効化の確認
                    if (!user.twoFactorEnabled) {
                      await authClient.twoFactor.enable({ password })
                      await authClient.twoFactor.sendOtp()
                      addToast({ title: t('msg_otp_sent'), color: 'success' })
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

          await intervalOperation(100)
          if (res.error) {
            console.debug(res.error)
            const msg = res.error.code === 'INVALID_EMAIL_OR_PASSWORD' ? t('msg_invalid_email_or_password') : undefined
            addToast({ title: t('auth_ng'), description: msg, color: 'danger' })
          }
        })}
      >
        <InputCtrlPassword
          control={control}
          name='password'
          label={t('password')}
          autoComplete='current-password'
          errorMessage={fet(errors.password)}
          isRequired
          autoFocus
        />
        <div className='flex items-center justify-between'>
          {mode === '2FA' ? (
            <div></div>
          ) : (
            <MultiButton
              isSecondary
              startContent={<ArrowLeftCircleIcon />}
              onPress={() => {
                back()
              }}
            >
              {t('back')}
            </MultiButton>
          )}
          {mode === '2FA' ? (
            <MultiButton type='submit' startContent={<ShieldCheckIcon />} isLoading={isSubmitting}>
              {t('auth')}
            </MultiButton>
          ) : (
            <MultiButton type='submit' startContent={<ArrowLeftEndOnRectangleIcon />} isLoading={isSubmitting}>
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
  password?: string
  callbackURL: string
}> = ({ direction, password, callbackURL }) => {
  const { t, fet } = useLocale()
  const router = useRouter()
  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<TwoFaCode>({
    resolver: zodResolver(scTwoFaCode),
    // mode: 'onChange',
    defaultValues: {
      otp: '',
    },
  })
  const formRef = useRef<HTMLFormElement>(null)

  return (
    <StepMotion direction={direction}>
      <form
        ref={formRef}
        onSubmit={handleSubmit(async (input) => {
          if (!password) {
            return
          }
          const res = await authClient.twoFactor.verifyOtp({
            code: input.otp,
            trustDevice: true,
          })
          await intervalOperation(100)
          if (res.error) {
            console.debug(res.error)
            addToast({ title: t('auth_ng'), color: 'danger' })
            return
          }
          router.push(callbackURL)
        })}
      >
        <div className={twMerge(textStyles().light(), 'text-xs')}>{t('msg_enter_otp')}</div>
        <div>
          <InputOtpCtrl
            className='mx-auto'
            control={control}
            name='otp'
            length={6}
            autoComplete='one-time-code'
            inputMode='numeric'
            errorMessage={fet(errors.otp)}
            isRequired
            autoFocus
            onComplete={() => {
              formRef.current?.requestSubmit()
            }}
          />
        </div>
        <div className='mt-2 flex items-center justify-between'>
          <MultiButton
            isSecondary
            startContent={<ArrowPathIcon />}
            coolTime={30}
            onPress={async () => {
              await authClient.twoFactor.sendOtp()
              addToast({ title: t('msg_otp_sent'), color: 'success' })
            }}
          >
            {t('resend')}
          </MultiButton>
          <MultiButton type='submit' startContent={<ShieldCheckIcon />} isLoading={isSubmitting}>
            {t('auth')}
          </MultiButton>
        </div>
      </form>
    </StepMotion>
  )
}

export const SignInClient: FC<{ sessionEmail?: string }> = ({ sessionEmail }) => {
  const searchParams = useSearchParams()
  const { t } = useLocale()
  const router = useRouter()
  const [step, setStep] = useState<'EMAIL' | 'PASSWORD' | 'OTP'>(sessionEmail ? 'PASSWORD' : 'EMAIL')
  const [direction, setDirection] = useState(1) // 1: 進む, -1: 戻る
  const [email, setEmail] = useState(sessionEmail)
  const [password, setPassword] = useState<string>()

  const callbackURL = searchParams.get('cb') ?? envu.client.NEXT_PUBLIC_URL
  const mode = searchParams.get('mode') as Mode
  const errorCode = searchParams.get('error')

  useEffect(() => {
    if (errorCode) {
      const msg = errorCode === 'user_not_exist' ? t('msg_user_not_exist') : undefined
      addToast({ title: t('auth_ng'), description: msg, color: 'danger' })
    }
  }, [errorCode, t])

  const viewTitle = useMemo(() => {
    if (mode === '2FA') {
      return t('twofa_enable')
    }
    if (step === 'OTP') {
      return t('twofa')
    }
    return t('signin')
  }, [mode, step, t])

  return (
    <SingleLayout icon={<KeyIcon />} title={viewTitle}>
      <div className={twMerge(gridStyles(), 'mb-4')}>
        <div className='col-span-3 flex'>
          <div className='text-lg'>{t('welcome')}</div>
        </div>
        {email && (
          <div className='col-span-9 flex h-full items-end'>
            <GrowMotion key='view_email' className='truncate text-sm font-semibold text-gray-400'>
              {email}
            </GrowMotion>
          </div>
        )}
      </div>

      <AnimatePresence mode='wait' custom={direction}>
        {step === 'EMAIL' && (
          <UsernameForm
            key='step_email'
            direction={direction}
            next={(email) => {
              setEmail(email)
              setDirection(1)
              setStep('PASSWORD')
            }}
          />
        )}

        {step === 'PASSWORD' && (
          <PasswordForm
            key='step_password'
            direction={direction}
            email={email}
            mode={mode}
            callbackURL={callbackURL}
            next={(password) => {
              setPassword(password)
              setStep('OTP')
            }}
            back={() => {
              setDirection(-1)
              setStep('EMAIL')
              setEmail(undefined)
            }}
          />
        )}

        {step === 'OTP' && (
          <OtpForm key='step_otp' direction={direction} password={password} callbackURL={callbackURL} />
        )}
      </AnimatePresence>

      {mode !== '2FA' && (
        <>
          <Divider className='mt-6 mb-4' />
          <MultiButton
            className='mx-auto mt-2 max-w-xs'
            fullWidth
            variant='flat'
            color='default'
            startContent={<GoogleIcon />}
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
            variant='flat'
            color='default'
            startContent={<FingerPrintIcon />}
            onPress={async () => {
              const { data, error } = await authClient.signIn.passkey()
              console.debug('passkey', { data, error })
              if (error) {
                addToast({ title: t('auth_ng'), color: 'danger' })
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
