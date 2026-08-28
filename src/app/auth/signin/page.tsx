import { auth } from '@/lib/auth/auth'
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

  if (mode === '2FA') {
    const session = await auth.api.getSession({ headers: await headers() })
    const email = session?.user.email
    return <SignInClient sessionEmail={email} />
  }

  return <SignInClient />
}
export default SignInPage
