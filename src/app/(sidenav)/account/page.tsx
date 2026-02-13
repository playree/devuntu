import { type Metadata } from 'next'
import { FC } from 'react'
import { AccountClient } from './client'

export const metadata: Metadata = {
  title: 'Account',
}

const AccountPage: FC = async () => {
  return <AccountClient />
}
export default AccountPage
