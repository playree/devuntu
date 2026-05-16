'use server'

import { safeAuthAction } from '@/lib/action-server'
import { auth } from '@/lib/auth'
import { errSystemError } from '@/lib/error'
import { logger } from '@/lib/logger'
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
    const res = await auth.api.adminCreateOAuthClient({
      headers: await headers(),
      body: {
        client_name: clientName,
        redirect_uris: [redirectUri],
        client_secret_expires_at: 0,
        skip_consent: true,
      },
    })
    logger.debug(res, 'auth.api.adminCreateOAuthClient')
    if (!res.client_secret) {
      throw errSystemError('client_secret is empty')
    }
    return { clientId: res.client_id, clientSecret: res.client_secret }
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
    logger.debug({ clientId }, 'auth.api.deleteOAuthClient')
    return { clientId }
  })
