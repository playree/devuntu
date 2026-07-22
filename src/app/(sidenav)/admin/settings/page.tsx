import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { AdminSettingsClient } from './client'

export const metadata: Metadata = {
  title: en.integration_settings,
}

/**
 * 連携設定ページ
 */
const AdminSettingsPage: FC = async () => {
  return <AdminSettingsClient />
}
export default AdminSettingsPage
