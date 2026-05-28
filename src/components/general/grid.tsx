import { cn } from '@heroui/react'
import { ComponentProps, FC } from 'react'

export const Grid: FC<ComponentProps<'div'>> = ({ children, className, ...props }) => (
  <div className={cn('grid grid-cols-12 gap-2', className)} {...props}>
    {children}
  </div>
)

export const GridBox: FC<ComponentProps<'div'>> = ({ children, className, ...props }) => (
  <div className={cn('grid grid-cols-12 gap-2', 'p-1', className)} {...props}>
    {children}
  </div>
)
