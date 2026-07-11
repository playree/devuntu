'use client'

import { Grid } from '@/components/general/grid'
import { ProgressBar } from '@/components/general/progress'
import { ArrowTopRightOnSquareIcon, InformationCircleIcon } from '@/components/icon'
import { parseAction } from '@/lib/action-client'
import { calcPercent, formatByte, formatTime } from '@/lib/math'
import { useLocale } from '@/locale/client'
import { useDraggable } from '@dnd-kit/react'
import { Card, Description, Separator, Skeleton } from '@heroui/react'
import Image from 'next/image'
import Link from 'next/link'
import { FC, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  getAnnouncement,
  GetAnnouncementReturnType,
  getAppInfo,
  GetAppInfoReturnType,
  getLinodeTransferInfo,
  GetLinodeTransferInfoReturnType,
  getOtherWidgets,
  GetOtherWidgetsReturnType,
  getReleaseNotes,
  GetReleaseNotesReturnType,
  getServerInfo,
  GetServerInfoReturnType,
} from './server'

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
    <Card ref={ref} className='h-full w-full gap-1 py-2'>
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
export const AppInfoWidgetName: FC = () => {
  const { t } = useLocale()
  return <>{t('app_info')}</>
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
    <Card ref={ref} className='h-full w-full gap-1 py-2'>
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
export const ServerInfoWidgetName: FC = () => {
  const { t } = useLocale()
  return <>{t('server_info')}</>
}

/**
 * Linode Transfer情報を表示する Widget。
 */
export const LinodeTransferInfoWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const { ref } = useDraggable({
    id,
    disabled: !editable,
  })
  const [data, setData] = useState<GetLinodeTransferInfoReturnType>()

  useEffect(() => {
    parseAction(getLinodeTransferInfo()).then((res) => setData(res))
  }, [])

  return (
    <Card ref={ref} className='h-full w-full gap-1 py-2'>
      <Card.Header>
        <div className='flex gap-1 font-bold'>
          <InformationCircleIcon />
          {t('linode_transfer_info')}
        </div>
      </Card.Header>
      <Card.Content>
        <Separator className='my-1' />
        {data ? (
          <Grid>
            <div className='col-span-4 text-sm'>{t('transfer_pool_usage')} :</div>
            <div className='col-span-8'>
              <ProgressBar progress={calcPercent(data.used, data.total)}>
                {formatByte(data.used)} / {data.quota}GiB
              </ProgressBar>
            </div>
            <div className='col-span-4 text-sm'>{t('transfer_billable')} :</div>
            <div className='col-span-8'>{data.billable}GiB</div>
          </Grid>
        ) : (
          <Skeleton className='h-full min-h-14 w-full rounded-xl' />
        )}
      </Card.Content>
    </Card>
  )
}
export const LinodeTransferInfoWidgetName: FC = () => {
  const { t } = useLocale()
  return <>{t('linode_transfer_info')}</>
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
  const [data, setData] = useState<GetReleaseNotesReturnType>()

  useEffect(() => {
    parseAction(getReleaseNotes()).then((res) => setData(res))
  }, [])

  return (
    <Card ref={ref} className='w-full gap-1 py-2'>
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
                  <div className='text-base font-bold'>{note.name}</div>
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
export const ReleaseNoteWidgetName: FC = () => {
  const { t } = useLocale()
  return <>{t('release_note')}</>
}

/**
 * お知らせ Widget。管理ページで編集された Markdown を表示する。
 */
export const AnnouncementWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const { ref } = useDraggable({
    id,
    disabled: !editable,
  })
  const [data, setData] = useState<GetAnnouncementReturnType>()

  useEffect(() => {
    parseAction(getAnnouncement()).then((res) => setData(res))
  }, [])

  return (
    <Card ref={ref} className='w-full gap-1 py-2'>
      <Card.Header>
        <div className='flex gap-1 font-bold'>
          <InformationCircleIcon />
          {t('announcement')}
        </div>
      </Card.Header>
      <Card.Content>
        <Separator className='my-1' />
        {data ? (
          <div className='max-h-80 min-h-14 flex-1 overflow-y-auto'>
            <div className='markdown'>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.body}</ReactMarkdown>
            </div>
          </div>
        ) : (
          <Skeleton className='h-full min-h-14 w-full rounded-xl' />
        )}
      </Card.Content>
    </Card>
  )
}
export const AnnouncementWidgetName: FC = () => {
  const { t } = useLocale()
  return <>{t('announcement')}</>
}

/**
 * LinkWidget。サーバー登録されたリンク情報を表示する Widget を生成するファクトリ。
 */
type LinkWidgetData = NonNullable<GetOtherWidgetsReturnType>['linkWidgets'][number]

const createLinkWidgetSet = (link: LinkWidgetData): Omit<WidgetSet, 'id'> => {
  // Link:はローカライズ不要
  const LinkWidgetName: FC = () => <>Link: {link.name}</>

  const LinkWidget: WidgetFC = ({ id, editable }) => {
    const { ref } = useDraggable({
      id,
      disabled: !editable,
    })

    const Content = (
      <>
        {link.iconPath ? (
          <Image src={link.iconPath} width={24} height={24} alt={link.name} unoptimized className='rounded' />
        ) : (
          <ArrowTopRightOnSquareIcon />
        )}
        {link.name}
        {link.description && <Description>- {link.description}</Description>}
      </>
    )

    return (
      <Card ref={ref} className='w-full gap-1 py-4'>
        {editable ? (
          <div className='flex items-center gap-2 font-bold'>{Content}</div>
        ) : (
          <Link href={link.url} target='_blank' rel='noopener noreferrer' className='flex items-center gap-2 font-bold'>
            {Content}
          </Link>
        )}
      </Card>
    )
  }

  return { name: LinkWidgetName, widget: LinkWidget }
}

const BaseWidgetMap: Record<string, Omit<WidgetSet, 'id'>> = {
  app_info: {
    name: AppInfoWidgetName,
    widget: AppInfoWidget,
  },
  server_info: {
    name: ServerInfoWidgetName,
    widget: ServerInfoWidget,
  },
  release_Note: {
    name: ReleaseNoteWidgetName,
    widget: ReleaseNoteWidget,
  },
  announcement: {
    name: AnnouncementWidgetName,
    widget: AnnouncementWidget,
  },
} as const

/**
 * 組み込み Widget にサーバー登録された LinkWidget をマージして返すフック。
 */
export const useWidgetMap = () => {
  const [widgetMap, setWidgetMap] = useState<Record<string, Omit<WidgetSet, 'id'>>>(BaseWidgetMap)

  useEffect(() => {
    parseAction(getOtherWidgets()).then((otherWidgets) => {
      const otherWidgetMap = Object.fromEntries(
        otherWidgets.linkWidgets.map((link) => [`link:${link.id}`, createLinkWidgetSet(link)]),
      )
      if (otherWidgets.enabledLinodeTransferInfo) {
        otherWidgetMap['linode_transfer_info'] = {
          name: LinodeTransferInfoWidgetName,
          widget: LinodeTransferInfoWidget,
        }
      }
      setWidgetMap({ ...BaseWidgetMap, ...otherWidgetMap })
    })
  }, [])

  return widgetMap
}
