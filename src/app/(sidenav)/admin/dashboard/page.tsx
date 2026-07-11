import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { AdminDashboardClient } from './client'

export const metadata: Metadata = {
  title: en.dashboard,
}

/**
 * ダッシュボード管理ページ
 */
const AdminDashboardPage: FC = async () => {
  return <AdminDashboardClient />
}
export default AdminDashboardPage
