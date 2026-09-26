import { getServerSession } from '@/lib/auth/auth'
import { envu } from '@/lib/env-util'
import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { SignInClient } from './client'

export const metadata: Metadata = {
  title: en.signin,
}

const SignInPage: FC<{
  searchParams: Promise<{ mode?: '2FA' }>
}> = async ({ searchParams }) => {
  const { mode } = await searchParams

  const twoFaRequired = envu.server.TWO_FA_REQUIRED

  // 2FA不要運用では有効化を促す画面自体が意味を持たないため通常のサインイン画面にする
  if (mode === '2FA' && twoFaRequired) {
    const session = await getServerSession()
    const email = session?.user.email
    return <SignInClient sessionEmail={email} twoFaRequired={twoFaRequired} />
  }

  return <SignInClient twoFaRequired={twoFaRequired} />
}
export default SignInPage
