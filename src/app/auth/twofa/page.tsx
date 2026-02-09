import { type Metadata } from 'next'
import { FC } from 'react'
import { TwoFaRegistClient } from './client'

export const metadata: Metadata = {
  title: 'Two-Factor Auth Regist',
}

const TwoFaRegistPage: FC = async () => {
  return <TwoFaRegistClient />
}
export default TwoFaRegistPage
