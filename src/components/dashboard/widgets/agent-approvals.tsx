'use client'

import { RocketLaunchIcon } from '@/components/icon'
import { PriorityChip, TicketIdText } from '@/components/ticket/ticket-chip'
import { parseAction } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { Chip } from '@heroui/react'
import { FC, useEffect, useState } from 'react'
import { getAgentApprovals, GetAgentApprovalsReturnType } from '../server'
import { RowLink } from './ticket-row'
import { WidgetCard, WidgetFC, WidgetRowList, WidgetSkeleton } from './widget-card'

/**
 * 自分が承認者になっているエージェントの、エージェントモード未選択のチケットを表示する Widget。
 * 承認者はボードのメンバーとは限らないため、行はチケットではなく `/agents` へ遷移させる。
 */
export const AgentApprovalsWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const [data, setData] = useState<GetAgentApprovalsReturnType>()

  useEffect(() => {
    parseAction(getAgentApprovals()).then((res) => setData(res))
  }, [])

  return (
    <WidgetCard
      id={id}
      editable={editable}
      icon={<RocketLaunchIcon />}
      title={
        <>
          {t('agent_approvals')}
          {data && data.total > 0 && (
            <Chip color='warning' variant='soft' size='sm' className='ml-1'>
              {t('agent_approvals_total', { count: data.total })}
            </Chip>
          )}
        </>
      }
    >
      {data ? (
        <WidgetRowList isEmpty={data.items.length === 0} message={t('msg_no_agent_approvals')}>
          {data.items.map((ticket) => (
            <RowLink key={ticket.id} href='/agents' editable={editable}>
              <div className='flex min-w-0 items-center gap-2'>
                <TicketIdText displayId={ticket.displayId} className='shrink-0' />
                <span className='truncate text-sm'>{ticket.title}</span>
              </div>
              <div className='flex min-w-0 items-center gap-2'>
                <PriorityChip priority={ticket.priority} />
                <span className='truncate text-xs text-gray-500'>{ticket.agentName}</span>
              </div>
            </RowLink>
          ))}
        </WidgetRowList>
      ) : (
        <WidgetSkeleton />
      )}
    </WidgetCard>
  )
}
export const AgentApprovalsWidgetName: FC = () => {
  const { t } = useLocale()
  return <>{t('agent_approvals')}</>
}
