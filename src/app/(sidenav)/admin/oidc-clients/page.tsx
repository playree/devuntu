import { envu } from '@/lib/env-util'
import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { OidcListClient } from './client'

export const metadata: Metadata = {
  title: en.oidc_clients,
}

const OidcClientsPage: FC = async () => {
  return <OidcListClient baseUrl={envu.server.BETTER_AUTH_URL} />
}
export default OidcClientsPage
