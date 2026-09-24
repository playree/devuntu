'use client'

import { useDraggable } from '@dnd-kit/react'
import { Card, cn, Separator, Skeleton } from '@heroui/react'
import { FC, ReactNode } from 'react'

export type WidgetFC = FC<{ id: string; editable: boolean }>

/** Widget 共通のカード。編集モードではカード全体をドラッグできる */
export const WidgetCard: FC<{
  id: string
  editable: boolean
  icon: ReactNode
  title: ReactNode
  className?: string
  children: ReactNode
}> = ({ id, editable, icon, title, className, children }) => {
  const { ref } = useDraggable({
    id,
    disabled: !editable,
  })

  return (
    <Card ref={ref} className={cn('w-full gap-1 py-2', className)}>
      <Card.Header>
        <div className='flex gap-1 font-bold'>
          {icon}
          {title}
        </div>
      </Card.Header>
      <Card.Content>
        <Separator className='my-1' />
        {children}
      </Card.Content>
    </Card>
  )
}

/** 取得中の表示 */
export const WidgetSkeleton: FC = () => <Skeleton className='h-full min-h-14 w-full rounded-xl' />
