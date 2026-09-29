'use client'

import { AccordionSection } from '@/components/general/accordion'
import { ClockIcon } from '@/components/icon'
import { PriorityChip, StatusChip } from '@/components/ticket/ticket-chip'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { TICKET_ACTIVITY_FIELD_LOCALE } from '@/lib/board/ticket-activity-rule'
import { isTicketPriority, isTicketStatus } from '@/lib/board/ticket-enum'
import { dayformat } from '@/lib/day'
import { useLocale } from '@/locale/client'
import { FC } from 'react'
import { GetTicketReturnType } from './server'

type Ticket = NonNullable<GetTicketReturnType>
type Activity = Ticket['activities'][number]

/** 変更前 / 変更後の1つぶん。ステータス・優先度はチップで出し、それ以外は文字列のまま出す */
const ActivityValue: FC<{ field: Activity['field']; value: string | null }> = ({ field, value }) => {
  if (value === null) {
    return <span className='text-muted'>-</span>
  }
  if (field === 'status' && isTicketStatus(value)) {
    return <StatusChip value={value} />
  }
  if (field === 'priority' && isTicketPriority(value)) {
    return <PriorityChip value={value} />
  }
  return <span className='line-clamp-3 break-all'>{value}</span>
}

/** 受け入れ条件は消した / 足した文言を行ごとに出す */
const CriteriaDiff: FC<{ activity: Activity }> = ({ activity }) => {
  const lines = (value: string | null, mark: string, className: string) =>
    (value?.split('\n') ?? []).map((line, index) => (
      <li key={`${mark}${index}`} className={className}>
        <span className='mr-1 font-mono'>{mark}</span>
        <span className='break-all'>{line}</span>
      </li>
    ))
  return (
    <ul className='space-y-0.5'>
      {lines(activity.before, '-', 'text-muted line-through')}
      {lines(activity.after, '+', '')}
    </ul>
  )
}

const ActivityDetail: FC<{ activity: Activity }> = ({ activity }) => {
  if (activity.field === 'created') {
    return null
  }
  if (activity.field === 'criteria') {
    return <CriteriaDiff activity={activity} />
  }
  return (
    <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
      <ActivityValue field={activity.field} value={activity.before} />
      <span className='text-muted'>→</span>
      <ActivityValue field={activity.field} value={activity.after} />
    </div>
  )
}

const ActivityItem: FC<{ activity: Activity }> = ({ activity }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()

  const actor = activity.source === 'merge' ? t('activity_by_merge') : activity.actorName || t('no_name')

  return (
    <li className='space-y-1 border-b border-(--border) pb-2 text-sm last:border-b-0'>
      <div className='flex flex-wrap items-center gap-x-2'>
        <span className='font-medium'>{actor}</span>
        <span className='text-muted'>{t(TICKET_ACTIVITY_FIELD_LOCALE[activity.field])}</span>
        <span className='text-muted ml-auto font-mono text-xs'>{dayformat(activity.createdAt, 'tz-minute', tz)}</span>
      </div>
      <ActivityDetail activity={activity} />
    </li>
  )
}

/** 変更履歴(新しい順)。閉じている間は描画しない */
export const TicketActivities: FC<{ ticket: Ticket }> = ({ ticket }) => {
  const { t } = useLocale()
  const { activities } = ticket
  if (activities.length === 0) {
    return null
  }

  return (
    <AccordionSection
      id='activities'
      icon={<ClockIcon />}
      title={`${t('ticket_activities')} (${activities.length})`}
      isLazyBody
    >
      <ul className='space-y-2'>
        {activities.map((activity) => (
          <ActivityItem key={activity.id} activity={activity} />
        ))}
      </ul>
    </AccordionSection>
  )
}
