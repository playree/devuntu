import { type Metadata } from 'next'
import { FC } from 'react'
import { TwoFARegistClient } from './client'

export const metadata: Metadata = {
  title: 'Two-Factor Auth Regist',
}

const TwoFARegistPage: FC = async () => {
  return <TwoFARegistClient />
}
export default TwoFARegistPage
