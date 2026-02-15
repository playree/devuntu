'use server'

import { safeAction } from '@/lib/action'
import { scSignInUsername } from '@/lib/schema'

export const getUserByEmail = safeAction
  .metadata({ actionName: 'getUserByEmail' })
  .inputSchema(scSignInUsername)
  .action(async ({ parsedInput: { username } }) => {
    return true
  })
