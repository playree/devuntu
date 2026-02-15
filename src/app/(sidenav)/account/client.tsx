'use client'

import { MultiButton } from '@/components/general/button'
import { authClient } from '@/lib/auth-client'
import { envu } from '@/lib/env-util'
import { FC } from 'react'

export const AccountClient: FC = () => {
  return (
    <div>
      <div>Account</div>
      <MultiButton
        onPress={async () => {
          const { data, error } = await authClient.passkey.addPasskey({
            name: envu.client.NEXT_PUBLIC_APP_NAME,
            authenticatorAttachment: 'platform',
          })
          console.debug('addPasskey', { data, error })
        }}
      >
        passkey
      </MultiButton>
    </div>
  )
}
