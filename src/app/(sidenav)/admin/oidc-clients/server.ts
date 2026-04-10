'use server'

import { safeAuthAction } from '@/lib/action'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

export const getOAuthClients = safeAuthAction
  .metadata({ actionName: 'getOAuthClients', role: 'admin' })
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
