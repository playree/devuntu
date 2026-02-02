import { createAuthClient } from 'better-auth/react'
import { envu } from './env-util'

export const authClient = createAuthClient({
  baseURL: envu.client.NEXT_PUBLIC_URL,
})
