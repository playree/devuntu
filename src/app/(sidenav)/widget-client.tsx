'use client'

import { Grid } from '@/components/general/grid'
import { ProgressBar } from '@/components/general/progress'
import { InformationCircleIcon } from '@/components/icon'
import { parseAction } from '@/lib/action-client'
import { calcPercent, formatByte, formatTime } from '@/lib/math'
import { DashboardLayout } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { useDraggable } from '@dnd-kit/react'
import { Card, Separator, Skeleton } from '@heroui/react'
import { FC, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getAppInfo, GetAppInfoReturnType, getServerInfo, GetServerInfoReturnType } from './server'

type WidgetFC = FC<{ id: string; editable: boolean }>

export type WidgetSet = {
  id: string
  name: FC
  widget: WidgetFC
}

/**
 * アプリのバージョン・ビルド番号を表示する Widget。
 */
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
export const AppInfoName: FC = () => {
  const { t } = useLocale()
  return t('app_info')
}

/**
 * サーバーの空きメモリ・稼働時間を表示する Widget。
 */
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
export const ServerInfoName: FC = () => {
  const { t } = useLocale()
  return t('server_info')
}

/**
 * リリースノート Widget。
 */
export const ReleaseNoteWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const { ref } = useDraggable({
    id,
    disabled: !editable,
  })
  const [data, setData] = useState<
    {
      id: string
      name: string
      body: string
    }[]
  >()

  useEffect(() => {
    fetch('https://api.github.com/repos/playree/wg-mui/releases' /* @todo 暫定 */, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      next: {
        revalidate: 180,
      },
    })
      .then((res) => res.json())
      .then((json) => setData(json))
  }, [])

  return (
    <Card ref={ref} className='w-full gap-1 pt-2'>
      <Card.Header>
        <div className='flex gap-1 font-bold'>
          <InformationCircleIcon />
          {t('release_note')}
        </div>
      </Card.Header>
      <Card.Content>
        <Separator className='my-1' />
        {data ? (
          <div className='max-h-80 min-h-14 flex-1 overflow-y-auto'>
            {data.map((note) => {
              return (
                <div key={note.id}>
                  <div className='text-sm font-bold'>{note.name}</div>
                  <div className='markdown'>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.body}</ReactMarkdown>
                  </div>
                  <Separator className='my-2' />
                </div>
              )
            })}
          </div>
        ) : (
          <Skeleton className='h-full min-h-14 w-full rounded-xl' />
        )}
      </Card.Content>
    </Card>
  )
}
export const ReleaseNoteName: FC = () => {
  const { t } = useLocale()
  return t('release_note')
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
  release_Note: {
    name: ReleaseNoteName,
    widget: ReleaseNoteWidget,
  },
} as const

export const WidgetStore: WidgetSet[] = Object.entries(WidgetMap).map(([key, props]) => ({ ...props, id: key }))

export const WidgetDefaultLayout: DashboardLayout = {
  left: ['app_info', 'server_info', null, null, null],
  right: ['release_Note', null, null, null, null],
} as const
