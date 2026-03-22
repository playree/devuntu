'use client'

import { Card } from '@heroui/react'
import { FC, ReactNode } from 'react'
import { twMerge } from 'tailwind-merge'
import { ThemeSwitchList } from './general/theme-switch'
import { LocaleSwitch } from './locale/locale-switch'

export const SingleLayout: FC<{
  children: ReactNode
  icon: ReactNode
  title: string
}> = ({ children, icon, title }) => {
  return (
    <div className='relative flex h-screen w-full items-center justify-center'>
      <div
        className={twMerge(
          'absolute inset-0 bg-size-[20px_20px]',
          'bg-[linear-gradient(to_right,#80808030_1px,transparent_1px),linear-gradient(to_bottom,#80808030_1px,transparent_1px)]',
          'mask-[radial-gradient(ellipse_80%_50%_at_50%_50%,#000_10%,transparent_100%)]',
        )}
      ></div>

      <div className='w-full max-w-md p-2 md:p-0'>
        <Card className='w-full'>
          <Card.Header className='px-2 md:px-4'>
            <div className='flex w-full items-center'>
              {icon}
              <div className='ml-2 text-lg font-semibold'>{title}</div>
              <div className='right-0 flex flex-auto justify-end'>
                <ThemeSwitchList size='sm' className='mr-2' />
                <LocaleSwitch size='sm' />
              </div>
            </div>
          </Card.Header>

          <Card.Content className='relative overflow-hidden px-2 pt-2 pb-6 md:px-4'>{children}</Card.Content>
        </Card>
      </div>
    </div>
  )
}
