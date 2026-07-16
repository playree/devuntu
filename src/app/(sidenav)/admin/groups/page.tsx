import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { AdminGroupsClient } from './client'

export const metadata: Metadata = {
  title: en.group_manage,
}

const AdminGroupsPage: FC = async () => {
  return <AdminGroupsClient />
}
export default AdminGroupsPage
