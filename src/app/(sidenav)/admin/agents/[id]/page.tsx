import { envu } from '@/lib/env-util'
import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { AdminAgentDetailClient } from './client'

export const metadata: Metadata = {
  title: en.agent_settings,
}

const AdminAgentDetailPage: FC<{ params: Promise<{ id: string }> }> = async ({ params }) => {
  const { id } = await params
  return <AdminAgentDetailClient agentId={id} baseUrl={envu.server.BETTER_AUTH_URL} />
}
export default AdminAgentDetailPage
