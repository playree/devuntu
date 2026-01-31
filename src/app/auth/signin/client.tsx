'use client'

import { MultiButton } from '@/components/general/button'
import { GrowMotion } from '@/components/general/grow-motion'
import { InputCtrl } from '@/components/general/input-ctrl'
import { StepMotion } from '@/components/general/step-motion'
import { ArrowLeftCircleIcon, ArrowRightCircleIcon, CheckIcon, KeyIcon } from '@/components/icon'
import { InputCtrlPassword } from '@/components/input-ctrl-pw'
import { authClient } from '@/lib/auth-client'
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

export const SignInClient: FC = () => {
  const searchParams = useSearchParams()
  const { t, fet } = useLocale()
  const [step, setStep] = useState(1)
  const [direction, setDirection] = useState(1) // 1: 進む, -1: 戻る
  const [email, setEmail] = useState<string>()

  const callbackURL = searchParams.get('callback') ?? '/'

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
    <Card className='m-auto w-full max-w-md p-4 shadow-md'>
      <CardHeader className={gridStyles()}>
        <div className='col-span-4 flex'>
          <KeyIcon className='mr-2' />
          <div className='text-lg font-semibold'>{t('signin')}</div>
        </div>
        {email && (
          <div className='col-span-8 flex h-full items-end'>
            <GrowMotion key='view_email' className='text-sm text-gray-400'>
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
                    startContent={<CheckIcon />}
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
  )
}
