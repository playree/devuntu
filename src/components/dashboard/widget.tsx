'use client'

import { ArrowTopRightOnSquareIcon } from '@/components/icon'
import { parseAction } from '@/lib/action/action-client'
import { type LocaleItem } from '@/locale'
import { useDraggable } from '@dnd-kit/react'
import { Card, cn, Description } from '@heroui/react'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { getOtherWidgets, GetOtherWidgetsReturnType } from './server'
import { AgentApprovalsWidget } from './widgets/agent-approvals'
import { AgentRunsWidget } from './widgets/agent-runs'
import { AnnouncementWidget } from './widgets/announcement'
import { AppInfoWidget } from './widgets/app-info'
import { CommandRunsWidget } from './widgets/command-runs'
import { DueSoonWidget } from './widgets/due-soon'
import { LinodeTransferInfoWidget } from './widgets/linode-transfer-info'
import { MentionsWidget } from './widgets/mentions'
import { MyTicketsWidget } from './widgets/my-tickets'
import { RecentActivityWidget } from './widgets/recent-activity'
import { ReleaseNoteWidget } from './widgets/release-note'
import { ServerInfoWidget } from './widgets/server-info'
import { TicketSummaryWidget } from './widgets/ticket-summary'
import { EditableLink, WidgetFC } from './widgets/widget-card'

/** 一覧に出す名前。組み込みはロケールキー、LinkWidget は登録された名前をそのまま出す */
type WidgetDef = { widget: WidgetFC } & ({ nameKey: LocaleItem } | { name: string })

export type WidgetSet = WidgetDef & { id: string }

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

    return (
      <Card ref={ref} className='w-full gap-1 py-2.5'>
        <EditableLink
          href={link.url}
          editable={editable}
          isExternal
          /**
           * チケット系ウィジェットの行(RowLink)と同じくマウスオーバーで背景を付ける。
           * 負の margin で打ち消し、見た目の位置と高さは従来どおりに保つ
           */
          className={cn(
            '-mx-2 flex items-center gap-2 rounded-lg px-2 py-1.5 font-bold',
            !editable && 'hover:bg-default/40',
          )}
        >
          {link.iconPath ? (
            <Image src={link.iconPath} width={24} height={24} alt={link.name} unoptimized className='rounded' />
          ) : (
            <ArrowTopRightOnSquareIcon />
          )}
          {link.name}
          {link.description && <Description>- {link.description}</Description>}
        </EditableLink>
      </Card>
    )
  }

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
