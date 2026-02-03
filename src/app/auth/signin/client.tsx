'use client'

import { MultiButton } from '@/components/general/button'
import { GrowMotion } from '@/components/general/grow-motion'
import { InputCtrl } from '@/components/general/input-ctrl'
import { LocaleSwitch } from '@/components/general/locale-switch'
import { StepMotion } from '@/components/general/step-motion'
import { ThemeSwitchList } from '@/components/general/theme-switch'
import { ArrowLeftCircleIcon, ArrowLeftEndOnRectangleIcon, ArrowRightCircleIcon, KeyIcon } from '@/components/icon'
import { InputCtrlPassword } from '@/components/input-ctrl-pw'
import { authClient } from '@/lib/auth-client'
import { envu } from '@/lib/env-util'
import { SignInEmail, SignInPassword, scSignInEmail, scSignInPassword } from '@/lib/schema'
import { intervalOperation } from '@/lib/sleep'
import { gridStyles } from '@/lib/style'
import { useLocale } from '@/locale/client'
import { Card, CardBody, CardHeader } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { AnimatePresence } from 'framer-motion'
import { useSearchParams } from 'next/navigation'
import { FC, useState } from 'react'
import { useForm } from 'react-hook-form'
import { twMerge } from 'tailwind-merge'
import { getUserByEmail } from './server'

export const SignInClient: FC = () => {
  const searchParams = useSearchParams()
  const { t, fet } = useLocale()
  const [step, setStep] = useState(1)
  const [direction, setDirection] = useState(1) // 1: 進む, -1: 戻る
  const [email, setEmail] = useState<string>()

  const callbackURL = searchParams.get('cb') ?? envu.client.NEXT_PUBLIC_URL

  const formEmail = useForm<SignInEmail>({
    resolver: zodResolver(scSignInEmail),
    mode: 'onChange',
    defaultValues: {
      email: '',
    },
  })

  const formPassword = useForm<SignInPassword>({
    resolver: zodResolver(scSignInPassword),
    mode: 'onChange',
    defaultValues: {
      password: '',
    },
  })

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
    <div className='relative h-screen w-full'>
      <div
        className={twMerge(
          'absolute inset-0 bg-size-[20px_20px]',
          'bg-[linear-gradient(to_right,#6f6f6f22_1px,transparent_1px),linear-gradient(to_bottom,#6f6f6f22_1px,transparent_1px)]',
          'mask-[radial-gradient(ellipse_80%_50%_at_50%_50%,#000_10%,transparent_100%)]',
        )}
      ></div>

      <div className='relative flex h-full items-center justify-center'>
        <div className='w-full max-w-lg p-2 md:p-0'>
          <div className='mb-4 flex items-center'>
            <KeyIcon className='mr-2' />
            <div className='text-lg font-semibold'>{t('signin')}</div>
            <div className='right-0 flex flex-auto justify-end'>
              <ThemeSwitchList size='sm' className='mr-2' />
              <LocaleSwitch size='sm' />
            </div>
          </div>
          <Card className='w-full p-2 md:p-4'>
            <CardHeader className={gridStyles()}>
              <div className='col-span-3 flex'>
                <div className='text-lg font-semibold'>{t('welcome')}</div>
              </div>
              {email && (
                <div className='col-span-9 flex h-full items-end'>
                  <GrowMotion key='view_email' className='font-semibold text-gray-400'>
                    {email}
                  </GrowMotion>
                </div>
              )}
            </CardHeader>
            <CardBody className='relative overflow-hidden'>
              <AnimatePresence mode='wait' custom={direction}>
                {step === 1 ? (
                  <StepMotion key='step1' direction={direction}>
                    <form
                      onSubmit={formEmail.handleSubmit(async (input) => {
                        await getUserByEmail(input)
                        await intervalOperation(200)
                        setEmail(input.email)
                        handleNext()
                      })}
                    >
                      <InputCtrl
                        control={formEmail.control}
                        name='email'
                        label={t('email')}
                        autoComplete='email'
                        errorMessage={fet(formEmail.formState.errors.email)}
                        isRequired
                      />
                      <div className='mt-4 flex items-center justify-end'>
                        <MultiButton
                          type='submit'
                          startContent={<ArrowRightCircleIcon />}
                          isLoading={formEmail.formState.isSubmitting}
                        >
                          {t('next')}
                        </MultiButton>
                      </div>
                    </form>
                  </StepMotion>
                ) : (
                  <StepMotion key='step2' direction={direction}>
                    <form
                      onSubmit={formPassword.handleSubmit(async (input) => {
                        if (!email) {
                          return
                        }
                        const res = await authClient.signIn.email({
                          email,
                          password: input.password,
                          rememberMe: true,
                          callbackURL,
                        })
                        console.log(res)
                        await intervalOperation()
                      })}
                    >
                      <InputCtrlPassword
                        control={formPassword.control}
                        name='password'
                        label={t('password')}
                        autoComplete='current-password'
                        errorMessage={fet(formPassword.formState.errors.password)}
                        isRequired
                      />
                      <div className='mt-4 flex items-center justify-between'>
                        <MultiButton
                          isSecondary
                          startContent={<ArrowLeftCircleIcon />}
                          onPress={() => {
                            handleBack()
                          }}
                        >
                          {t('back')}
                        </MultiButton>
                        <MultiButton
                          type='submit'
                          startContent={<ArrowLeftEndOnRectangleIcon />}
                          isLoading={formPassword.formState.isSubmitting}
                        >
                          {t('signin')}
                        </MultiButton>
                      </div>
                    </form>
                  </StepMotion>
                )}
              </AnimatePresence>
            </CardBody>
          </Card>

          <Card className='mt-4 w-full p-4'></Card>
        </div>
      </div>
    </div>
  )
}
