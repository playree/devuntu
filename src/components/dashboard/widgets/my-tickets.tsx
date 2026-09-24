'use client'

import { TicketIcon } from '@/components/icon'
import { useActionData } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { FC } from 'react'
import { getMyTickets } from '../server'
import { TicketRowList } from './ticket-row'
import { WidgetCard, WidgetFC, WidgetLoadError, WidgetSkeleton } from './widget-card'

/**
 * 自分が担当する未完了チケットを優先度 → 期日の順に表示する Widget。
 */
export const MyTicketsWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const { data, isLoading } = useActionData(getMyTickets)

  return (
    <WidgetCard id={id} editable={editable} icon={<TicketIcon />} title={t('my_tickets')}>
      {data ? (
        <TicketRowList tickets={data} tz={tz} editable={editable} message={t('msg_no_tickets')} />
      ) : isLoading ? (
        <WidgetSkeleton />
      ) : (
        <WidgetLoadError />
      )}
    </WidgetCard>
  )
}
export const MyTicketsWidgetName: FC = () => {
  const { t } = useLocale()
  return <>{t('my_tickets')}</>
}
