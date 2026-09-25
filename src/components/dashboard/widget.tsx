'use client'

import { Grid } from '@/components/general/grid'
import { ProgressBar } from '@/components/general/progress'
import { ArrowTopRightOnSquareIcon, InformationCircleIcon } from '@/components/icon'
import { MarkdownView } from '@/components/markdown/markdown-view'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { calcPercent, formatByte, formatTime } from '@/lib/math'
import { type LocaleItem } from '@/locale'
import { useLocale } from '@/locale/client'
import { useDraggable } from '@dnd-kit/react'
import { Card, Description, Separator } from '@heroui/react'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  getAnnouncement,
  getAppInfo,
  getLinodeTransferInfo,
  getOtherWidgets,
  GetOtherWidgetsReturnType,
  getReleaseNotes,
  getServerInfo,
} from './server'
import { AgentApprovalsWidget } from './widgets/agent-approvals'
import { AgentRunsWidget } from './widgets/agent-runs'
import { CommandRunsWidget } from './widgets/command-runs'
import { DueSoonWidget } from './widgets/due-soon'
import { MentionsWidget } from './widgets/mentions'
import { MyTicketsWidget } from './widgets/my-tickets'
import { RecentActivityWidget } from './widgets/recent-activity'
import { TicketSummaryWidget } from './widgets/ticket-summary'
import { WidgetDataCard, WidgetFC } from './widgets/widget-card'

/** 一覧に出す名前。組み込みはロケールキー、LinkWidget は登録された名前をそのまま出す */
type WidgetDef = { widget: WidgetFC } & ({ nameKey: LocaleItem } | { name: string })

export type WidgetSet = WidgetDef & { id: string }

/**
 * アプリのバージョン・ビルド番号を表示する Widget。
 */
export const AppInfoWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const { data, isLoading } = useActionData(getAppInfo)

  return (
    <WidgetDataCard
      id={id}
      editable={editable}
      icon={<InformationCircleIcon />}
      title={t('app_info')}
      className='h-full'
      data={data}
      isLoading={isLoading}
    >
      {(data) => (
        <Grid>
          <div className='col-span-4 text-sm'>{t('version')} :</div>
          <div className='col-span-8'>{data.version}</div>
          <div className='col-span-4 text-sm'>{t('buildno')} :</div>
          <div className='col-span-8'>{data.buildno}</div>
        </Grid>
      )}
    </WidgetDataCard>
  )
}

/**
 * サーバーの空きメモリ・稼働時間を表示する Widget。
 */
export const ServerInfoWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const { data, isLoading } = useActionData(getServerInfo)

  return (
    <WidgetDataCard
      id={id}
      editable={editable}
      icon={<InformationCircleIcon />}
      title={t('server_info')}
      className='h-full'
      data={data}
      isLoading={isLoading}
    >
      {(data) => (
        <Grid>
          <div className='col-span-4 text-sm'>{t('free_memory')} :</div>
          <div className='col-span-8'>
            <ProgressBar progress={calcPercent(data.memory.free, data.memory.total)} aria-label={t('free_memory')}>
              {formatByte(data.memory.free)} / {formatByte(data.memory.total)}
            </ProgressBar>
          </div>
          <div className='col-span-4 text-sm'>{t('uptime')} :</div>
          <div className='col-span-8'>{formatTime(data.uptime)}</div>
        </Grid>
      )}
    </WidgetDataCard>
  )
}

/**
 * Linode Transfer情報を表示する Widget。
 * `LINODE_*` が未設定で Action が null を返した場合も、取得完了後は失敗として扱う。
 */
export const LinodeTransferInfoWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const { data, isLoading } = useActionData(getLinodeTransferInfo)

  return (
    <WidgetDataCard
      id={id}
      editable={editable}
      icon={<InformationCircleIcon />}
      title={t('linode_transfer_info')}
      className='h-full'
      data={data}
      isLoading={isLoading}
    >
      {(data) => (
        <Grid>
          <div className='col-span-4 text-sm'>{t('transfer_pool_usage')} :</div>
          <div className='col-span-8'>
            <ProgressBar progress={calcPercent(data.used, data.total)} aria-label={t('transfer_pool_usage')}>
              {formatByte(data.used)} / {data.quota}GiB
            </ProgressBar>
          </div>
          <div className='col-span-4 text-sm'>{t('transfer_billable')} :</div>
          <div className='col-span-8'>{data.billable}GiB</div>
        </Grid>
      )}
    </WidgetDataCard>
  )
}

/**
 * リリースノート Widget。
 */
export const ReleaseNoteWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const { data, isLoading } = useActionData(getReleaseNotes)

  return (
    <WidgetDataCard
      id={id}
      editable={editable}
      icon={<InformationCircleIcon />}
      title={t('release_note')}
      data={data}
      isLoading={isLoading}
    >
      {(data) => (
        <div className='max-h-80 min-h-14 flex-1 overflow-y-auto'>
          {data.map((note) => {
            return (
              <div key={note.id}>
                <div className='text-base font-bold'>{note.name}</div>
                <MarkdownView body={note.body} />
                <Separator className='my-2' />
              </div>
            )
          })}
        </div>
      )}
    </WidgetDataCard>
  )
}

/**
 * お知らせ Widget。管理ページで編集された Markdown を表示する。
 */
export const AnnouncementWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const { data, isLoading } = useActionData(getAnnouncement)

  return (
    <WidgetDataCard
      id={id}
      editable={editable}
      icon={<InformationCircleIcon />}
      title={t('announcement')}
      data={data}
      isLoading={isLoading}
    >
      {(data) => (
        <div className='max-h-80 min-h-14 flex-1 overflow-y-auto'>
          <MarkdownView body={data.body} />
        </div>
      )}
    </WidgetDataCard>
  )
}

/**
 * LinkWidget。サーバー登録されたリンク情報を表示する Widget を生成するファクトリ。
 */
type LinkWidgetData = NonNullable<GetOtherWidgetsReturnType>['linkWidgets'][number]

const createLinkWidgetSet = (link: LinkWidgetData): WidgetDef => {
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

    // チケット系ウィジェットの行(RowLink)と同じくマウスオーバーで背景を付ける。
    // 負の margin で打ち消し、見た目の位置と高さは従来どおりに保つ
    const className = '-mx-2 flex items-center gap-2 rounded-lg px-2 py-1.5 font-bold'

    return (
      <Card ref={ref} className='w-full gap-1 py-2.5'>
        {editable ? (
          <div className={className}>{Content}</div>
        ) : (
          <Link
            href={link.url}
            target='_blank'
            rel='noopener noreferrer'
            className={`${className} hover:bg-default/40`}
          >
            {Content}
          </Link>
        )}
      </Card>
    )
  }

  // Link:はローカライズ不要
  return { name: `Link: ${link.name}`, widget: LinkWidget }
}

const BaseWidgetMap: Record<string, WidgetDef> = {
  app_info: {
    nameKey: 'app_info',
    widget: AppInfoWidget,
  },
  server_info: {
    nameKey: 'server_info',
    widget: ServerInfoWidget,
  },
  release_Note: {
    nameKey: 'release_note',
    widget: ReleaseNoteWidget,
  },
  announcement: {
    nameKey: 'announcement',
    widget: AnnouncementWidget,
  },
  my_tickets: {
    nameKey: 'my_tickets',
    widget: MyTicketsWidget,
  },
  due_soon: {
    nameKey: 'due_soon',
    widget: DueSoonWidget,
  },
  ticket_summary: {
    nameKey: 'ticket_summary',
    widget: TicketSummaryWidget,
  },
  mentions: {
    nameKey: 'my_mentions',
    widget: MentionsWidget,
  },
  recent_activity: {
    nameKey: 'recent_activity',
    widget: RecentActivityWidget,
  },
} as const

/**
 * 組み込み Widget に、サーバー登録された LinkWidget と条件付きの Widget をマージして返すフック。
 */
export const useWidgetMap = () => {
  const [widgetMap, setWidgetMap] = useState<Record<string, WidgetDef>>(BaseWidgetMap)

  useEffect(() => {
    parseAction(getOtherWidgets())
      .then((otherWidgets) => {
        const otherWidgetMap = Object.fromEntries(
          otherWidgets.linkWidgets.map((link) => [`link:${link.id}`, createLinkWidgetSet(link)]),
        )
        if (otherWidgets.enabledLinodeTransferInfo) {
          otherWidgetMap['linode_transfer_info'] = {
            nameKey: 'linode_transfer_info',
            widget: LinodeTransferInfoWidget,
          }
        }
        if (otherWidgets.enabledAgentWidgets) {
          otherWidgetMap['agent_approvals'] = { nameKey: 'agent_approvals', widget: AgentApprovalsWidget }
          otherWidgetMap['agent_runs'] = { nameKey: 'agent_runs_recent', widget: AgentRunsWidget }
        }
        if (otherWidgets.enabledCommandRuns) {
          otherWidgetMap['command_runs'] = { nameKey: 'command_runs_recent', widget: CommandRunsWidget }
        }
        setWidgetMap({ ...BaseWidgetMap, ...otherWidgetMap })
      })
      // 失敗の通知は parseAction が済ませている。組み込みの Widget だけで表示を続ける
      .catch(() => {})
  }, [])

  return widgetMap
}
