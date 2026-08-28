import { passkeyClient } from '@better-auth/passkey/client'
import { adminClient, emailOTPClient, inferAdditionalFields, twoFactorClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import type { auth } from './auth'

export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<typeof auth>(), adminClient(), emailOTPClient(), twoFactorClient(), passkeyClient()],
})
