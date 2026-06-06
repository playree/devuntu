import { cn } from '@heroui/react'
import { FC, ReactNode } from 'react'

export const ProgressBar: FC<{
  children?: ReactNode
  progress: number
  className?: string
}> = ({ children, progress, className }) => {
  return (
    <div className='relative w-full rounded-sm bg-neutral-200 dark:bg-neutral-600'>
      <div
        className={cn('rounded-sm bg-blue-300 p-1 text-center leading-none text-white dark:bg-blue-700', className)}
        style={{ width: `${progress}%` }}
      >
        &nbsp;
      </div>
      <div
        className={cn(
          'absolute top-0 w-full p-1 text-center leading-none font-bold text-gray-700 dark:text-white',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}
