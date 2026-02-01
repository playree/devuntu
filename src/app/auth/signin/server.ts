'use server'

import { safeAction } from '@/lib/action'
import { scSignInEmail } from '@/lib/schema'

export const getUserByEmail = safeAction
  .metadata({ actionName: 'getUserByEmail' })
  .inputSchema(scSignInEmail)
  .action(async ({ parsedInput: { email } }) => {
    return true
  })
