'use client'

import { ClockIcon } from '@/components/icon'
import { StatusChip, TicketIdText } from '@/components/ticket/ticket-chip'
import { parseAction } from '@/lib/action/action-client'
import { dayformat } from '@/lib/day'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { FC, useEffect, useState } from 'react'
import { getRecentActivity, GetRecentActivityReturnType } from '../server'
import { RowLink } from './ticket-row'
import { WidgetCard, WidgetFC, WidgetRowList, WidgetSkeleton } from './widget-card'

/**
 * アクセスできるボードのチケットを更新日時の新しい順に表示する Widget。
 */
export const RecentActivityWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const [data, setData] = useState<GetRecentActivityReturnType>()

  useEffect(() => {
    parseAction(getRecentActivity()).then((res) => setData(res))
  }, [])

  return (
    <WidgetCard id={id} editable={editable} icon={<ClockIcon />} title={t('recent_activity')}>
      {data ? (
        <WidgetRowList isEmpty={data.length === 0} message={t('msg_no_recent_activity')}>
          {data.map((ticket) => (
            <RowLink key={ticket.id} href={`/t/${ticket.displayId}`} editable={editable}>
              <div className='flex min-w-0 items-center gap-2'>
                <TicketIdText displayId={ticket.displayId} className='shrink-0' />
                <span className='truncate text-sm'>{ticket.title}</span>
              </div>
              <div className='flex items-center gap-2'>
                <StatusChip status={ticket.status} />
                <span className='font-mono text-xs text-gray-500'>{dayformat(ticket.updatedAt, 'tz-minute', tz)}</span>
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
export const RecentActivityWidgetName: FC = () => {
  const { t } = useLocale()
  return <>{t('recent_activity')}</>
}
