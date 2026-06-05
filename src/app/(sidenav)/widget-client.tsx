'use client'

import { Grid } from '@/components/general/grid'
import { ProgressBar } from '@/components/general/progress'
import { InformationCircleIcon } from '@/components/icon'
import { parseAction } from '@/lib/action-client'
import { calcPercent, formatByte, formatTime } from '@/lib/math'
import { useLocale } from '@/locale/client'
import { useDraggable } from '@dnd-kit/react'
import { Card, Separator, Skeleton } from '@heroui/react'
import { FC, useEffect, useState } from 'react'
import { getAppInfo, GetAppInfoReturnType, getServerInfo, GetServerInfoReturnType } from './server'

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
        <Separator className='my-1' />
        {data ? (
          <Grid>
            <div className='col-span-4 text-sm'>{t('version')} :</div>
            <div className='col-span-8'>{data.version}</div>
            <div className='col-span-4 text-sm'>{t('buildno')} :</div>
            <div className='col-span-8'>{data.buildno}</div>
          </Grid>
        ) : (
          <Skeleton className='h-full min-h-14 w-full rounded-xl' />
        )}
      </Card.Content>
    </Card>
  )
}

export const ServerInfoName: FC = () => {
  const { t } = useLocale()
  return t('server_info')
}
export const ServerInfoWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const { ref } = useDraggable({
    id,
    disabled: !editable,
  })
  const [data, setData] = useState<GetServerInfoReturnType>()

  useEffect(() => {
    parseAction(getServerInfo()).then((res) => setData(res))
  }, [])

  return (
    <Card ref={ref} className='h-full w-full gap-1 pt-2'>
      <Card.Header>
        <div className='flex gap-1 font-bold'>
          <InformationCircleIcon />
          {t('server_info')}
        </div>
      </Card.Header>
      <Card.Content>
        <Separator className='my-1' />
        {data ? (
          <Grid>
            <div className='col-span-4 text-sm'>{t('free_memory')} :</div>
            <div className='col-span-8'>
              <ProgressBar progress={calcPercent(data.memory.free, data.memory.total)}>
                {formatByte(data.memory.free)} / {formatByte(data.memory.total)}
              </ProgressBar>
            </div>
            <div className='col-span-4 text-sm'>{t('uptime')} :</div>
            <div className='col-span-8'>{formatTime(data.uptime)}</div>
          </Grid>
        ) : (
          <Skeleton className='h-full min-h-14 w-full rounded-xl' />
        )}
      </Card.Content>
    </Card>
  )
}

export const WidgetMap: Record<string, Omit<WidgetSet, 'id'>> = {
  app_info: {
    name: AppInfoName,
    widget: AppInfoWidget,
  },
  server_info: {
    name: ServerInfoName,
    widget: ServerInfoWidget,
  },
} as const

export const WidgetStore: WidgetSet[] = Object.entries(WidgetMap).map(([key, props]) => ({ ...props, id: key }))

// export const WidgetStore: WidgetSet[] = [
//   {
//     id: 'app_info',
//     name: AppInfoName,
//     widget: AppInfoWidget,
//   },
//   {
//     id: 'server_info',
//     name: ServerInfoName,
//     widget: ServerInfoWidget,
//   },
// ] as const
