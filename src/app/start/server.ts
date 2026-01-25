'use server'

import { safeAction } from '@/lib/action'
import { scCreateAdmin } from '@/lib/schema'

export const createAdmin = safeAction
  .metadata({ actionName: 'createAdmin' })
  .inputSchema(scCreateAdmin)
  .action(async ({ parsedInput }) => {
    return 'OK'
  })
