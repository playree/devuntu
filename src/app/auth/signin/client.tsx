'use client'

import { MultiButton } from '@/components/general/button'
import { Grid } from '@/components/general/grid'
import { GrowMotion } from '@/components/general/grow-motion'
import { useStep } from '@/components/general/step-motion'
import { FingerPrintIcon, GoogleIcon, KeyIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { SingleLayout } from '@/components/single-layout'
import { authClient } from '@/lib/auth/auth-client'
import { authConfig } from '@/lib/auth/auth-config'
import { makePath, navigateAfterAuth, safeCallbackPath } from '@/lib/client-utils'
import { textStyles } from '@/lib/style'
import { useLocale } from '@/locale/client'
import { cn, Separator } from '@heroui/react'
import { AnimatePresence } from 'framer-motion'
import { useSearchParams } from 'next/navigation'
import { FC, useEffect, useMemo, useRef, useState } from 'react'

import { OtpForm } from './otp-form'
import { type Mode, PasswordForm } from './password-form'
import { TwoFaForm } from './two-fa-form'
import { UsernameForm } from './username-form'

export const SignInClient: FC<{ sessionEmail?: string; twoFaRequired: boolean }> = ({
  sessionEmail,
  twoFaRequired,
}) => {
  const searchParams = useSearchParams()
  const { t } = useLocale()
  const { step, forward, back } = useStep<'EMAIL' | 'PASSWORD' | 'OTP' | '2FA'>(sessionEmail ? 'PASSWORD' : 'EMAIL')
  const [email, setEmail] = useState(sessionEmail)
  const [password, setPassword] = useState<string>()

  const clientId = searchParams.get('client_id')
  // cb は URL 由来なので必ず safeCallbackPath を通す(素通しするとオープンリダイレクトになる)
  const callbackURL = clientId
    ? makePath('/api/auth/oauth2/authorize', searchParams)
    : safeCallbackPath(searchParams.get('cb'))
  // 2FA不要運用では有効化を促す画面に意味が無いので、mode を無視して通常のサインイン画面として扱う
  const mode = twoFaRequired ? (searchParams.get('mode') as Mode) : null
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
        case 'unable_to_get_user_info':
          msg = t('msg_not_allowed_domain_in_google')
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
                forward(nextStep)
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
              twoFaRequired={twoFaRequired}
              callbackURL={callbackURL}
              next={(password) => {
                setPassword(password)
                forward('2FA')
              }}
              back={() => {
                back('EMAIL')
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
                back('EMAIL')
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
            variant='outline'
            icon={<GoogleIcon />}
            onPress={async () => {
              await authClient.signIn.social({
                provider: 'google',
                callbackURL,
                errorCallbackURL: makePath(authConfig.path.signIn, searchParams).toString(),
              })
            }}
          >
            {t('google_signin')}
          </MultiButton>
          <MultiButton
            className='mx-auto mt-2 max-w-xs'
            fullWidth
            variant='outline'
            icon={<FingerPrintIcon />}
            onPress={async () => {
              const { error } = await authClient.signIn.passkey()
              if (error) {
                console.debug(error)
                notify.warn(t('auth_ng'))
                return
              }
              navigateAfterAuth(callbackURL)
            }}
          >
            {t('passkey_signin')}
          </MultiButton>
        </>
      )}
    </SingleLayout>
  )
}
