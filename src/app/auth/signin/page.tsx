import { type Metadata } from 'next'
import { FC } from 'react'
import { SignInClient } from './client'

export const metadata: Metadata = {
  title: 'SignIn',
}

const SignInPage: FC = async () => {
  return <SignInClient />
}
export default SignInPage
