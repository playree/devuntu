'use client'
import { cn } from '@heroui/react'
import { ComponentProps, FC } from 'react'
import { SmartProvider, useSmart } from './smart'

export const FlexCol: FC<ComponentProps<'div'> & { isSmart?: boolean; isSmartForm?: boolean }> = ({
  children,
  className,
  isSmart: isSmartProp,
  isSmartForm: isSmartFormProp,
  ...props
}) => {
  const { isCompact } = useSmart(isSmartProp, isSmartFormProp)
  return (
    <SmartProvider isSmart={isSmartProp} isSmartForm={isSmartFormProp}>
      <div className={cn('flex flex-col', isCompact ? 'gap-1' : 'gap-2', className)} {...props}>
        {children}
      </div>
    </SmartProvider>
  )
}

export const FlexRow: FC<ComponentProps<'div'> & { isSmart?: boolean; isSmartForm?: boolean }> = ({
  children,
  className,
  isSmart: isSmartProp,
  isSmartForm: isSmartFormProp,
  ...props
}) => {
  const { isCompact } = useSmart(isSmartProp, isSmartFormProp)
  return (
    <SmartProvider isSmart={isSmartProp} isSmartForm={isSmartFormProp}>
      <div className={cn('flex flex-row', isCompact ? 'gap-1' : 'gap-2', className)} {...props}>
        {children}
      </div>
    </SmartProvider>
  )
}
