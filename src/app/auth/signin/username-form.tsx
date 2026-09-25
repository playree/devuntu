'use client'

import { MultiButton } from '@/components/general/button'
import { InputCtrl } from '@/components/general/input'
import { StepMotion } from '@/components/general/step-motion'
import { ArrowRightCircleIcon } from '@/components/icon'
import { parseAction } from '@/lib/action/action-client'
import { ClientError } from '@/lib/error'
import { scSignInUsername, SignInUsername } from '@/lib/schema/schema-auth'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { useSearchParams } from 'next/navigation'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { getUserByEmail } from './server'

export const UsernameForm: FC<{
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
          try {
            const res = await parseAction(getUserByEmail(input))
            if (res?.next) {
              next(input.username, res.next)
            }
          } catch (e) {
            // レート制限などは parseAction が通知済み。時間をおけば再試行できるので画面はそのまま残す
            if (!(e instanceof ClientError)) {
              throw e
            }
          }
        })}
      >
        <InputCtrl
          control={control}
          variant='secondary'
          name='username'
          label={t('email')}
          autoComplete='username'
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
