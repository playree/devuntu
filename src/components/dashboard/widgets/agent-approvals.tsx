'use client'

import { RocketLaunchIcon } from '@/components/icon'
import { PriorityChip } from '@/components/ticket/ticket-chip'
import { useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { Chip } from '@heroui/react'
import { getAgentApprovals } from '../server'
import { RowLink, TicketTitleLine } from './ticket-row'
import { WidgetDataCard, WidgetFC, WidgetRowList } from './widget-card'

/**
 * 自分が承認者になっているエージェントの、エージェントモード未選択のチケットを表示する Widget。
 * 承認者はボードのメンバーとは限らないため、行はチケットではなく `/agents` へ遷移させる。
 */
export const AgentApprovalsWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const { data, isLoading } = useActionData(getAgentApprovals)

  return (
    <WidgetDataCard
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
      data={data}
      isLoading={isLoading}
    >
      {(data) => (
        <WidgetRowList isEmpty={data.items.length === 0} message={t('msg_no_agent_approvals')}>
          {data.items.map((ticket) => (
            <RowLink key={ticket.id} href='/agents' editable={editable}>
              <TicketTitleLine ticket={ticket} />
              <div className='flex min-w-0 items-center gap-2'>
                <PriorityChip value={ticket.priority} />
                <span className='truncate text-xs text-gray-500'>{ticket.agentName}</span>
              </div>
            </RowLink>
          ))}
        </WidgetRowList>
      )}
    </WidgetDataCard>
  )
}
