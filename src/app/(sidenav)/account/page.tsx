import { getServerSession } from '@/lib/auth'
import { canUseGoogleAccount } from '@/lib/google-account'
import { type Metadata } from 'next'
import { FC } from 'react'
import { AccountClient } from './client'

export const metadata: Metadata = {
  title: 'Account',
}

const AccountPage: FC = async () => {
  const session = await getServerSession()
  const googleAvailable = session ? await canUseGoogleAccount(session.user.id) : false
  return <AccountClient googleAvailable={googleAvailable} />
}
export default AccountPage
