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
  searchParams: Promise<{ mode?: '2FA'; client_id?: string; max_age?: string }>
}> = async ({ searchParams }) => {
  const { mode, client_id: clientId, max_age: maxAge } = await searchParams

  const twoFaRequired = envu.server.TWO_FA_REQUIRED

  // 2FA不要運用では有効化を促す画面自体が意味を持たないため通常のサインイン画面にする
  if (mode === '2FA' && twoFaRequired) {
    const session = await getServerSession()
    const email = session?.user.email
    return <SignInClient sessionEmail={email} twoFaRequired={twoFaRequired} />
  }

  /**
   * ログイン済みで OAuth の認可から送られてきたのは、セッションが `max_age` より古いため
   * (`offline_access` の認可には `SESSION_FRESH_AGE` が差し込まれる)。再認証だと分かるようにする。
   */
  if (clientId && maxAge !== undefined) {
    const session = await getServerSession()
    if (session) {
      return <SignInClient reAuthEmail={session.user.email} twoFaRequired={twoFaRequired} />
    }
  }

  return <SignInClient twoFaRequired={twoFaRequired} />
}
export default SignInPage
