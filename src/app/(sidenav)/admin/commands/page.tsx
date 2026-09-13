import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { AdminCommandsClient } from './client'

export const metadata: Metadata = {
  title: en.command_manage,
}

/**
 * コマンド管理ページ
 */
const AdminCommandsPage: FC = async () => {
  return <AdminCommandsClient />
}
export default AdminCommandsPage
