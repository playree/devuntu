import { envu } from '@/lib/env-util'
import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { AdminAgentsClient } from './client'

export const metadata: Metadata = {
  title: en.agent_manage,
}

const AdminAgentsPage: FC = async () => {
  return <AdminAgentsClient baseUrl={envu.server.BETTER_AUTH_URL} />
}
export default AdminAgentsPage
