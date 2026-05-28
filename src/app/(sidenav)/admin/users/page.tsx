import { auth } from '@/lib/auth'
import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { UsersClient } from './client'

export const metadata: Metadata = {
  title: en.user_manage,
}

const UsersPage: FC = async () => {
  return <UsersClient enabledPassword={auth.options.emailAndPassword.enabled} />
}
export default UsersPage
