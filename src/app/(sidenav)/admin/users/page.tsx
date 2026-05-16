import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { UsersClient } from './client'

export const metadata: Metadata = {
  title: en.user_manage,
}

const UsersPage: FC = async () => {
  return <UsersClient />
}
export default UsersPage
