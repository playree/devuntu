import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { OidcListClient } from './client'

export const metadata: Metadata = {
  title: en.oidc_clients,
}

const OidcClientsPage: FC = async () => {
  return <OidcListClient />
}
export default OidcClientsPage
