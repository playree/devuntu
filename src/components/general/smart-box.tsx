'use client'
import { cn } from '@heroui/react'
import { ComponentProps, FC } from 'react'
import { SmartProvider, useSmart } from './smart'

export type SmartBoxProps = ComponentProps<'div'> & { isSmart?: boolean; isSmartForm?: boolean }

/**
 * isSmart / isSmartForm を配下へ伝播し、コンパクト表示のときは gap を詰める div を作る。
 * FlexCol / Grid などのレイアウト部品は baseClass だけが違う。
 */
export const createSmartBox = (baseClass: string, displayName: string) => {
  const SmartBox: FC<SmartBoxProps> = ({
    children,
    className,
    isSmart: isSmartProp,
    isSmartForm: isSmartFormProp,
    ...props
  }) => {
    const { isCompact } = useSmart(isSmartProp, isSmartFormProp)
    return (
      <SmartProvider isSmart={isSmartProp} isSmartForm={isSmartFormProp}>
        <div className={cn(baseClass, isCompact ? 'gap-1' : 'gap-2', className)} {...props}>
          {children}
        </div>
      </SmartProvider>
    )
  }
  SmartBox.displayName = displayName
  return SmartBox
}
