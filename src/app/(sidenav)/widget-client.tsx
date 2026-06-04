'use client'

import { Grid } from '@/components/general/grid'
import { InformationCircleIcon } from '@/components/icon'
import { parseAction } from '@/lib/action-client'
import { useLocale } from '@/locale/client'
import { useDraggable } from '@dnd-kit/react'
import { Card, Separator, Skeleton } from '@heroui/react'
import { FC, useEffect, useState } from 'react'
import { getAppInfo, GetAppInfoReturnType } from './server'

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
  const { t } = useLocale()
  const { ref } = useDraggable({
    id,
    disabled: !editable,
  })
  const [data, setData] = useState<GetAppInfoReturnType>()

  useEffect(() => {
    parseAction(getAppInfo()).then((res) => setData(res))
  }, [])

  return (
    <Card ref={ref} className='h-full w-full gap-1 pt-2'>
      <Card.Header>
        <div className='flex gap-1 font-bold'>
          <InformationCircleIcon />
          {t('app_info')}
        </div>
      </Card.Header>
      <Card.Content>
        <Separator />
        {data ? (
          <Grid>
            <div className='col-span-4 text-sm font-bold'>{t('version')} :</div>
            <div className='col-span-8'>{data.version}</div>
            <div className='col-span-4 text-sm font-bold'>{t('buildno')} :</div>
            <div className='col-span-8'>{data.buildno}</div>
          </Grid>
        ) : (
          <Skeleton className='h-full min-h-14 w-full rounded-xl' />
        )}
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
