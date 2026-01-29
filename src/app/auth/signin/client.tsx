'use client'

import { MultiButton } from '@/components/general/button'
import { InputCtrl } from '@/components/general/input-ctrl'
import { ArrowRightCircleIcon, KeyIcon } from '@/components/icon'
import { InputCtrlPassword } from '@/components/input-ctrl-pw'
import { SignInEmail, SignInPassword, scSignInEmail, scSignInPassword } from '@/lib/schema'
import { intervalOperation } from '@/lib/sleep'
import { useLocale } from '@/locale/client'
import { Card, CardBody, CardHeader } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { AnimatePresence, motion } from 'framer-motion'
import { FC, useState } from 'react'
import { useForm } from 'react-hook-form'

export const SignInClient: FC = () => {
  const { t, fet } = useLocale()
  const [step, setStep] = useState(1)
  const [direction, setDirection] = useState(1) // 1: 進む, -1: 戻る

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

  const variants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 50 : -50,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      x: direction > 0 ? -50 : 50,
      opacity: 0,
    }),
  }

  const handleNext = () => {
    setDirection(1)
    setStep(2)
  }

  const handleBack = () => {
    setDirection(-1)
    setStep(1)
  }

  return (
    <Card className='m-auto w-full max-w-md p-4 shadow-md'>
      <CardHeader className='text-lg font-semibold'>
        <KeyIcon className='mr-2' />
        {t('signin')}
      </CardHeader>
      <CardBody className='relative overflow-hidden'>
        <AnimatePresence mode='wait' custom={direction}>
          {step === 1 ? (
            <motion.div
              key='step1'
              custom={direction}
              variants={variants}
              initial='enter'
              animate='center'
              exit='exit'
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className='w-full space-y-4'
            >
              <form
                onSubmit={formEmail.handleSubmit(async (input) => {
                  await intervalOperation(200)
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
            </motion.div>
          ) : (
            <motion.div
              key='step2'
              custom={direction}
              variants={variants}
              initial='enter'
              animate='center'
              exit='exit'
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className='w-full space-y-4'
            >
              <form
                onSubmit={formPassword.handleSubmit(async (input) => {
                  await intervalOperation()
                  handleNext()
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
                    startContent={<ArrowRightCircleIcon />}
                    onPress={() => {
                      handleBack()
                    }}
                  >
                    {t('back')}
                  </MultiButton>
                  <MultiButton
                    type='submit'
                    startContent={<ArrowRightCircleIcon />}
                    isLoading={formPassword.formState.isSubmitting}
                  >
                    {t('next')}
                  </MultiButton>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </CardBody>
    </Card>
  )
}
