'use client'

import { ClockIcon } from '@/components/icon'
import { parseAction } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { FC, useEffect, useState } from 'react'
import { getDueSoonTickets, GetDueSoonTicketsReturnType } from '../server'
import { TicketRowList } from './ticket-row'
import { WidgetCard, WidgetFC, WidgetSkeleton } from './widget-card'

/**
 * 自分が担当する未完了チケットのうち、期限切れと 7 日以内が期日のものを表示する Widget。
 */
export const DueSoonWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const [data, setData] = useState<GetDueSoonTicketsReturnType>()

  useEffect(() => {
    parseAction(getDueSoonTickets()).then((res) => setData(res))
  }, [])

  return (
    <WidgetCard id={id} editable={editable} icon={<ClockIcon />} title={t('due_soon')}>
      {data ? (
        <TicketRowList tickets={data} tz={tz} editable={editable} message={t('msg_no_due_soon_tickets')} />
      ) : (
        <WidgetSkeleton />
      )}
    </WidgetCard>
  )
}
export const DueSoonWidgetName: FC = () => {
  const { t } = useLocale()
  return <>{t('due_soon')}</>
}
