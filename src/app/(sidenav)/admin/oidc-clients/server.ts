'use server'

import { safeAuthAction } from '@/lib/action-server'
import { auth } from '@/lib/auth'
import { scAddOidcClient, scDeleteOidcClient } from '@/lib/schema'
import { headers } from 'next/headers'

export const getOidcClients = safeAuthAction
  .metadata({ actionName: 'getOidcClients', role: 'admin' })
  .action(async () => {
    const data = await auth.api.getOAuthClients({
      headers: await headers(),
    })
    if (data) {
      return data.map(({ client_id, client_name, skip_consent }) => ({
        clientId: client_id,
        clientName: client_name,
        skipConsent: skip_consent,
      }))
    }
    return []
  })

export const addOidcClient = safeAuthAction
  .metadata({ actionName: 'addOidcClient', role: 'admin' })
  .inputSchema(scAddOidcClient)
  .action(async ({ parsedInput: { clientName, redirectUri } }) => {
    const { client_id } = await auth.api.adminCreateOAuthClient({
      headers: await headers(),
      body: {
        client_name: clientName,
        redirect_uris: [redirectUri],
        client_secret_expires_at: 0,
        skip_consent: true,
      },
    })
    return { clientId: client_id }
  })

export const deleteOidcClient = safeAuthAction
  .metadata({ actionName: 'deleteOidcClient', role: 'admin' })
  .inputSchema(scDeleteOidcClient)
  .action(async ({ parsedInput: { clientId } }) => {
    await auth.api.deleteOAuthClient({
      headers: await headers(),
      body: {
        client_id: clientId,
      },
    })
    return { clientId }
  })
