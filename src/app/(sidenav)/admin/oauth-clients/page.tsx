import { type Metadata } from 'next'
import { FC } from 'react'
import { OAuthListClient } from './client'

export const metadata: Metadata = {
  title: 'OAuth Client',
}

const OAuthClientPage: FC = async () => {
  return <OAuthListClient />
}
export default OAuthClientPage
