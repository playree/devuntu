import { cn } from '@heroui/react'
import { ComponentProps, FC } from 'react'

export const FlexCol: FC<ComponentProps<'div'>> = ({ children, className, ...props }) => (
  <div className={cn('flex flex-col gap-2', className)} {...props}>
    {children}
  </div>
)
