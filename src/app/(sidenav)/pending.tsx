'use client'

import { authClient } from '@/lib/auth/auth-client'
import { cn, Spinner } from '@heroui/react'
import { FC, ReactNode } from 'react'

/** セッションを取得できるまでは待機表示を出し、取得できたら children を描画する */
export const SessionPending: FC<{ children: ReactNode }> = ({ children }) => {
  const { data: session } = authClient.useSession()

  if (session?.user) {
    return children
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
