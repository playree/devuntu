'use client'

import { useLocale } from '@/locale/client'
import { useDraggable } from '@dnd-kit/react'
import { Card, Skeleton } from '@heroui/react'
import { FC } from 'react'

type WidgetFC = FC<{ id: string; editable: boolean }>

export type WidgetSet = {
  id: string
  name: FC
  widget: WidgetFC
}

export const AppInfoName: FC = () => {
  const { t } = useLocale()
  return t('app_info')
}
export const AppInfoWidget: WidgetFC = ({ id, editable }) => {
  const { ref } = useDraggable({
    id,
    disabled: !editable,
  })
  return (
    <Card ref={ref} className='h-full w-full pt-2'>
      <Card.Header>test</Card.Header>
      <Card.Content>
        <Skeleton className='h-full w-full rounded-xl' />
      </Card.Content>
    </Card>
  )
}

export const WidgetStore: WidgetSet[] = [
  {
    id: 'app_info',
    name: AppInfoName,
    widget: AppInfoWidget,
  },
] as const
