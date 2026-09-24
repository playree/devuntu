'use client'

import { TicketIcon } from '@/components/icon'
import { parseAction } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { FC, useEffect, useState } from 'react'
import { getMyTickets, GetMyTicketsReturnType } from '../server'
import { TicketRowList } from './ticket-row'
import { WidgetCard, WidgetFC, WidgetSkeleton } from './widget-card'

/**
 * 自分が担当する未完了チケットを優先度 → 期日の順に表示する Widget。
 */
export const MyTicketsWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const [data, setData] = useState<GetMyTicketsReturnType>()

  useEffect(() => {
    parseAction(getMyTickets()).then((res) => setData(res))
  }, [])

  return (
    <WidgetCard id={id} editable={editable} icon={<TicketIcon />} title={t('my_tickets')}>
      {data ? (
        <TicketRowList tickets={data} tz={tz} editable={editable} message={t('msg_no_tickets')} />
      ) : (
        <WidgetSkeleton />
      )}
    </WidgetCard>
  )
}
export const MyTicketsWidgetName: FC = () => {
  const { t } = useLocale()
  return <>{t('my_tickets')}</>
}
