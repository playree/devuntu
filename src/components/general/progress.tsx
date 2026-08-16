import { cn } from '@heroui/react'
import { FC, ReactNode } from 'react'

export const ProgressBar: FC<{
  children?: ReactNode
  progress: number
  /** 何の進捗かを示す読み上げ名。バー内の文字は値の表示なので名前にはならない */
  ariaLabel: string
  className?: string
}> = ({ children, progress, ariaLabel, className }) => {
  return (
    <div
      className='relative w-full rounded-sm bg-neutral-200 dark:bg-neutral-600'
      role='progressbar'
      aria-label={ariaLabel}
      aria-valuenow={progress}
      aria-valuemin={0}
      aria-valuemax={100}
    >
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
