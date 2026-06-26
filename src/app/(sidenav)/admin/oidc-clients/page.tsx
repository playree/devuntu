import { envu } from '@/lib/env-util'
import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { AdminOidcListClient } from './client'

export const metadata: Metadata = {
  title: en.oidc_clients,
}

const AdminOidcClientsPage: FC = async () => {
  return <AdminOidcListClient baseUrl={envu.server.BETTER_AUTH_URL} />
}
export default AdminOidcClientsPage
