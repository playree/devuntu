'use client'

import { MultiButton } from '@/components/general/button'
import { GrowMotion } from '@/components/general/grow-motion'
import { InputCtrl } from '@/components/general/input-ctrl'
import { StepMotion } from '@/components/general/step-motion'
import {
  ArrowLeftCircleIcon,
  ArrowLeftEndOnRectangleIcon,
  ArrowRightCircleIcon,
  GoogleIcon,
  KeyIcon,
} from '@/components/icon'
import { InputCtrlPassword } from '@/components/input-ctrl-pw'
import { SingleLayout } from '@/components/single-layout'
import { authClient } from '@/lib/auth-client'
import { authConfig } from '@/lib/auth-config'
import { envu, makeUrl } from '@/lib/env-util'
import { scSignInEmail, scSignInPassword, SignInEmail, SignInPassword } from '@/lib/schema'
import { intervalOperation } from '@/lib/sleep'
import { gridStyles } from '@/lib/style'
import { useLocale } from '@/locale/client'
import { addToast, Divider } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { AnimatePresence } from 'framer-motion'
import { useSearchParams } from 'next/navigation'
import { FC, useState } from 'react'
import { useForm } from 'react-hook-form'
import { twMerge } from 'tailwind-merge'
import { getUserByEmail } from './server'

const EmailForm: FC<{
  direction: number
  visible: boolean
  next: (email: string) => void
}> = ({ direction, visible, next }) => {
  const { t, fet } = useLocale()
  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<SignInEmail>({
    resolver: zodResolver(scSignInEmail),
    // mode: 'onChange',
    defaultValues: {
      email: '',
    },
  })

  return (
    <StepMotion direction={direction} visible={visible}>
      <form
        onSubmit={handleSubmit(async (input) => {
          await getUserByEmail(input)
          await intervalOperation(200)
          next(input.email)
        })}
      >
        <InputCtrl
          control={control}
          name='email'
          label={t('email')}
          autoComplete='email'
          errorMessage={fet(errors.email)}
          isRequired
        />
        <div className='mt-4 flex items-center justify-end'>
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
  visible: boolean
  email?: string
  callbackURL: string
  back: () => void
}> = ({ direction, visible, email, callbackURL, back }) => {
  const { t, fet } = useLocale()
  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<SignInPassword>({
    resolver: zodResolver(scSignInPassword),
    mode: 'onChange',
    defaultValues: {
      password: '',
    },
  })

  return (
    <StepMotion direction={direction} visible={visible}>
      <form
        onSubmit={handleSubmit(async (input) => {
          if (!email) {
            return
          }
          const res = await authClient.signIn.email({
            email,
            password: input.password,
            rememberMe: true,
            callbackURL,
          })
          console.debug(res)
          await intervalOperation()
          if (res.error) {
            addToast({
              title: t('auth_ng'),
              description: t('msg_invalid_email_or_password'),
              color: 'danger',
            })
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
        />
        <div className='mt-4 flex items-center justify-between'>
          <MultiButton
            isSecondary
            startContent={<ArrowLeftCircleIcon />}
            onPress={() => {
              back()
            }}
          >
            {t('back')}
          </MultiButton>
          <MultiButton type='submit' startContent={<ArrowLeftEndOnRectangleIcon />} isLoading={isSubmitting}>
            {t('signin')}
          </MultiButton>
        </div>
      </form>
    </StepMotion>
  )
}

export const SignInClient: FC = () => {
  const searchParams = useSearchParams()
  const { t } = useLocale()
  const [step, setStep] = useState(1)
  const [direction, setDirection] = useState(1) // 1: 進む, -1: 戻る
  const [email, setEmail] = useState<string>()

  const callbackURL = searchParams.get('cb') ?? envu.client.NEXT_PUBLIC_URL

  const handleNext = () => {
    setDirection(1)
    setStep(2)
  }

  const handleBack = () => {
    setEmail(undefined)
    setDirection(-1)
    setStep(1)
  }

  return (
    <SingleLayout icon={<KeyIcon />} title={t('signin')}>
      <div className={twMerge(gridStyles(), 'mb-2')}>
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
        <EmailForm
          key='step_email'
          direction={direction}
          visible={step === 1}
          next={(email) => {
            setEmail(email)
            handleNext()
          }}
        />

        <PasswordForm
          key='step_password'
          direction={direction}
          visible={step !== 1}
          email={email}
          callbackURL={callbackURL}
          back={() => {
            handleBack()
          }}
        />
      </AnimatePresence>

      <Divider className='my-6' />

      <MultiButton
        className='mx-auto max-w-xs'
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
    </SingleLayout>
  )
}
