import { passkeyClient } from '@better-auth/passkey/client'
import { adminClient, emailOTPClient, twoFactorClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { envu } from './env-util'

export const authClient = createAuthClient({
  baseURL: envu.client.NEXT_PUBLIC_URL,
  plugins: [adminClient(), emailOTPClient(), twoFactorClient(), passkeyClient()],
})
