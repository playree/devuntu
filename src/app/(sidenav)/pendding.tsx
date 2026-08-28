'use client'

import { authClient } from '@/lib/auth/auth-client'
import { cn, Spinner } from '@heroui/react'

export const getPendding = () => {
  const { data: session } = authClient.useSession()

  if (session?.user) {
    return null
  }

  return (
    <div className='relative flex h-screen w-full items-center justify-center'>
      <div
        className={cn(
          'absolute inset-0 bg-size-[20px_20px]',
          'bg-[linear-gradient(to_right,#80808030_1px,transparent_1px),linear-gradient(to_bottom,#80808030_1px,transparent_1px)]',
          'mask-[radial-gradient(ellipse_80%_50%_at_50%_50%,#000_10%,transparent_100%)]',
        )}
      ></div>
      <Spinner size='xl' />
    </div>
  )
}
