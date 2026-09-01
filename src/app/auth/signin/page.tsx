import { auth } from '@/lib/auth/auth'
import { envu } from '@/lib/env-util'
import { type Metadata } from 'next'
import { headers } from 'next/headers'
import { FC } from 'react'
import { SignInClient } from './client'

export const metadata: Metadata = {
  title: 'SignIn',
}

const SignInPage: FC<{
  searchParams: Promise<{ mode?: '2FA' }>
}> = async ({ searchParams }) => {
  const { mode } = await searchParams

  const twoFaRequired = envu.server.TWO_FA_REQUIRED

  if (mode === '2FA') {
    const session = await auth.api.getSession({ headers: await headers() })
    const email = session?.user.email
    return <SignInClient sessionEmail={email} twoFaRequired={twoFaRequired} />
  }

  return <SignInClient twoFaRequired={twoFaRequired} />
}
export default SignInPage
