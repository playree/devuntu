'use client'
import { cn } from '@heroui/react'
import { ComponentProps, FC } from 'react'
import { SmartProvider, useIsSmart } from './smart'

export const FlexCol: FC<ComponentProps<'div'> & { isSmart?: boolean }> = ({
  children,
  className,
  isSmart: isSmartProp,
  ...props
}) => {
  const isSmart = useIsSmart(isSmartProp)
  return (
    <SmartProvider isSmart={isSmart}>
      <div className={cn('flex flex-col', isSmart ? 'gap-1' : 'gap-2', className)} {...props}>
        {children}
      </div>
    </SmartProvider>
  )
}
