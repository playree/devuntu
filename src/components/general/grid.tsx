'use client'
import { cn } from '@heroui/react'
import { ComponentProps, FC } from 'react'
import { SmartProvider, useSmart } from './smart'

export const Grid: FC<ComponentProps<'div'> & { isSmart?: boolean; isSmartForm?: boolean }> = ({
  children,
  className,
  isSmart: isSmartProp,
  isSmartForm: isSmartFormProp,
  ...props
}) => {
  const { isCompact } = useSmart(isSmartProp, isSmartFormProp)
  return (
    <SmartProvider isSmart={isSmartProp} isSmartForm={isSmartFormProp}>
      <div className={cn('grid grid-cols-12', isCompact ? 'gap-1' : 'gap-2', className)} {...props}>
        {children}
      </div>
    </SmartProvider>
  )
}

export const GridBox: FC<ComponentProps<'div'> & { isSmart?: boolean; isSmartForm?: boolean }> = ({
  children,
  className,
  isSmart: isSmartProp,
  isSmartForm: isSmartFormProp,
  ...props
}) => {
  const { isCompact } = useSmart(isSmartProp, isSmartFormProp)
  return (
    <SmartProvider isSmart={isSmartProp} isSmartForm={isSmartFormProp}>
      <div className={cn('grid grid-cols-12', 'p-1', isCompact ? 'gap-1' : 'gap-2', className)} {...props}>
        {children}
      </div>
    </SmartProvider>
  )
}
