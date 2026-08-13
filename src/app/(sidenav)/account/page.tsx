import { getServerSession } from '@/lib/auth'
import { canUseGoogleAccount } from '@/lib/google-account'
import { canUseSlackAccount } from '@/lib/slack-account'
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
  return <AccountClient googleAvailable={googleAvailable} slackAvailable={slackAvailable} />
}
export default AccountPage
