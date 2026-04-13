'use server'

import { safeAuthAction } from '@/lib/action-server'
import { auth } from '@/lib/auth'
import { scAddOidcClient } from '@/lib/schema'
import { headers } from 'next/headers'

export const getOidcClients = safeAuthAction
  .metadata({ actionName: 'getOidcClients', role: 'admin' })
  .action(async () => {
    const data = await auth.api.getOAuthClients({
      headers: await headers(),
    })
    if (data) {
      return data.map(({ client_id, client_name }) => ({
        client_id,
        client_name,
      }))
    }
    return []
  })

export const addOidcClient = safeAuthAction
  .metadata({ actionName: 'addOidcClient', role: 'admin' })
  .inputSchema(scAddOidcClient)
  .action(async ({ parsedInput: { clientName, redirectUri } }) => {
    await auth.api.adminCreateOAuthClient({
      headers: await headers(),
      body: {
        client_name: clientName,
        redirect_uris: [redirectUri],
        client_secret_expires_at: 0,
        skip_consent: true,
      },
    })
  })
