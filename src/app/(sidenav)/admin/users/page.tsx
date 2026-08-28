import { auth } from '@/lib/auth/auth'
import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { AdminUsersClient } from './client'

export const metadata: Metadata = {
  title: en.user_manage,
}

const AdminUsersPage: FC = async () => {
  return <AdminUsersClient enabledPassword={auth.options.emailAndPassword.enabled} />
}
export default AdminUsersPage
