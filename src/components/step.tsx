import { textStyles } from '@/lib/style'
import { Divider } from '@heroui/react'
import { FC, ReactNode } from 'react'
import { twMerge } from 'tailwind-merge'

export const Step: FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <div className='mb-2 flex items-center'>
      <div className={twMerge(textStyles().light(), 'pr-2 text-sm')}>{children}</div>
      <Divider className='flex-auto' />
    </div>
  )
}
