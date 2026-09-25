'use client'

import { ClockIcon } from '@/components/icon'
import { StatusChip } from '@/components/ticket/ticket-chip'
import { useActionData } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { useLocale } from '@/locale/client'
import { getRecentActivity } from '../server'
import { RowLink, TicketTitleLine } from './ticket-row'
import { WidgetDataCard, WidgetFC, WidgetRowList } from './widget-card'

/**
 * アクセスできるボードのチケットを更新日時の新しい順に表示する Widget。
 */
export const RecentActivityWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const { data, isLoading } = useActionData(getRecentActivity)

  return (
    <WidgetDataCard
      id={id}
      editable={editable}
      icon={<ClockIcon />}
      title={t('recent_activity')}
      data={data}
      isLoading={isLoading}
    >
      {(data) => (
        <WidgetRowList isEmpty={data.length === 0} message={t('msg_no_recent_activity')}>
          {data.map((ticket) => (
            <RowLink key={ticket.id} href={`/t/${ticket.displayId}`} editable={editable}>
              <TicketTitleLine ticket={ticket} />
              <div className='flex items-center gap-2'>
                <StatusChip value={ticket.status} />
                <span className='text-muted font-mono text-xs'>{dayformat(ticket.updatedAt, 'tz-minute', tz)}</span>
              </div>
            </RowLink>
          ))}
        </WidgetRowList>
      )}
    </WidgetDataCard>
  )
}
