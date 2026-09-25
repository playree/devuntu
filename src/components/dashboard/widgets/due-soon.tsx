'use client'

import { ClockIcon } from '@/components/icon'
import { useActionData } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { getDueSoonTickets } from '../server'
import { TicketRowList } from './ticket-row'
import { WidgetDataCard, WidgetFC } from './widget-card'

/**
 * 自分が担当する未完了チケットのうち、期限切れと 7 日以内が期日のものを表示する Widget。
 */
export const DueSoonWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const { data, isLoading } = useActionData(getDueSoonTickets)

  return (
    <WidgetDataCard
      id={id}
      editable={editable}
      icon={<ClockIcon />}
      title={t('due_soon')}
      data={data}
      isLoading={isLoading}
    >
      {(data) => <TicketRowList tickets={data} tz={tz} editable={editable} message={t('msg_no_due_soon_tickets')} />}
    </WidgetDataCard>
  )
}
