'use client'

import { TicketIcon } from '@/components/icon'
import { useActionData } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { useLocale } from '@/locale/client'
import { getMyTickets } from '../server'
import { TicketRowList } from './ticket-row'
import { WidgetDataCard, WidgetFC } from './widget-card'

/**
 * 自分が担当する未完了チケットを優先度 → 期日の順に表示する Widget。
 */
export const MyTicketsWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const { data, isLoading } = useActionData(getMyTickets)

  return (
    <WidgetDataCard
      id={id}
      editable={editable}
      icon={<TicketIcon />}
      title={t('my_tickets')}
      data={data}
      isLoading={isLoading}
    >
      {(data) => <TicketRowList tickets={data} tz={tz} editable={editable} message={t('msg_no_tickets')} />}
    </WidgetDataCard>
  )
}
