'use server'

import { safeAuthAction } from '@/lib/action-server'
import { auth, OIDC_PROVIDER_SCOPES } from '@/lib/auth'
import { errSystemError } from '@/lib/error'
import { logger } from '@/lib/logger'
import { scAddOidcClient, scDeleteOidcClient, scUpdateOidcClient } from '@/lib/schema'
import { headers } from 'next/headers'

export const getOidcClients = safeAuthAction
  .metadata({ actionName: 'getOidcClients', role: 'admin' })
  .action(async () => {
    const data = await auth.api.getOAuthClients({
      headers: await headers(),
    })
    if (data) {
      return data.map(({ client_id, client_name, redirect_uris, skip_consent, require_pkce }) => ({
        clientId: client_id,
        clientName: client_name ?? '',
        redirectUri: redirect_uris[0],
        skipConsent: skip_consent ?? false,
        requirePkce: require_pkce ?? false,
      }))
    }
    return []
  })

export const addOidcClient = safeAuthAction
  .metadata({ actionName: 'addOidcClient', role: 'admin' })
  .inputSchema(scAddOidcClient)
  .action(async ({ parsedInput: { clientName, redirectUri, skipConsent, requirePkce } }) => {
    const res = await auth.api.adminCreateOAuthClient({
      headers: await headers(),
      body: {
        client_name: clientName,
        redirect_uris: [redirectUri],
        client_secret_expires_at: 0,
        skip_consent: skipConsent,
        require_pkce: requirePkce,
        scope: OIDC_PROVIDER_SCOPES.join(' '),
      },
    })
    logger.info(res, 'auth.api.adminCreateOAuthClient')
    if (!res.client_secret) {
      throw errSystemError('client_secret is empty')
    }
    return { clientId: res.client_id, clientSecret: res.client_secret }
  })

export const updateOidcClient = safeAuthAction
  .metadata({ actionName: 'updateOidcClient', role: 'admin' })
  .inputSchema(scUpdateOidcClient)
  .action(async ({ parsedInput: { clientId, clientName, redirectUri, skipConsent } }) => {
    const res = await auth.api.adminUpdateOAuthClient({
      headers: await headers(),
      body: {
        client_id: clientId,
        update: {
          client_name: clientName,
          redirect_uris: [redirectUri],
          skip_consent: skipConsent,
        },
      },
    })
    logger.info(res, 'auth.api.adminUpdateOAuthClient')
    return { clientId: res.client_id }
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
    logger.info({ clientId }, 'auth.api.deleteOAuthClient')
    return { clientId }
  })
