import { auth } from '@/lib/auth/auth'
import { hasCompletedInitialSetup } from '@/lib/initial-setup'
import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { redirect } from 'next/navigation'
import { FC } from 'react'
import { StartClient } from './client'

export const metadata: Metadata = {
  title: en.admin_regist,
}

const StartPage: FC = async () => {
  if (await hasCompletedInitialSetup()) {
    redirect('/')
  }

  return <StartClient enabledPassword={auth.options.emailAndPassword.enabled} />
}
export default StartPage
