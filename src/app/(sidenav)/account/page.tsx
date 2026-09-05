import { getServerSession } from '@/lib/auth/auth'
import { envu } from '@/lib/env-util'
import { canUseGoogleAccount } from '@/lib/google/google-account'
import { canUseSlackAccount } from '@/lib/slack/slack-account'
import { type Metadata } from 'next'
import { FC } from 'react'
import { AccountClient } from './client'

export const metadata: Metadata = {
  title: 'Account',
}

const AccountPage: FC = async () => {
  const session = await getServerSession()
  const [googleAvailable, slackAvailable] = session
    ? await Promise.all([canUseGoogleAccount(session.user.id), canUseSlackAccount(session.user.id)])
    : [false, false]
  return (
    <AccountClient
      googleAvailable={googleAvailable}
      slackAvailable={slackAvailable}
      baseUrl={envu.server.BETTER_AUTH_URL}
    />
  )
}
export default AccountPage
