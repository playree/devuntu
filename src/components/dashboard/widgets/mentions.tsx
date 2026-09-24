'use client'

import { ChatBubbleIcon } from '@/components/icon'
import { TicketIdText } from '@/components/ticket/ticket-chip'
import { parseAction } from '@/lib/action/action-client'
import { dayformat } from '@/lib/day'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { FC, useEffect, useState } from 'react'
import { getMentions, GetMentionsReturnType } from '../server'
import { RowLink } from './ticket-row'
import { WidgetCard, WidgetFC, WidgetRowList, WidgetSkeleton } from './widget-card'

/**
 * 自分宛てのメンション(チケット本文・コメント)を新しい順に表示する Widget。
 */
export const MentionsWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const [data, setData] = useState<GetMentionsReturnType>()

  useEffect(() => {
    parseAction(getMentions()).then((res) => setData(res))
  }, [])

  return (
    <WidgetCard id={id} editable={editable} icon={<ChatBubbleIcon />} title={t('my_mentions')}>
      {data ? (
        <WidgetRowList isEmpty={data.length === 0} message={t('msg_no_mentions')}>
          {data.map((item) => (
            <RowLink key={item.key} href={item.href} editable={editable}>
              <div className='flex min-w-0 items-center gap-2'>
                <TicketIdText displayId={item.ticket.displayId} className='shrink-0' />
                <span className='truncate text-sm'>{item.ticket.title}</span>
              </div>
              <div className='flex min-w-0 items-center gap-2 text-xs text-gray-500'>
                <span className='min-w-0 truncate'>
                  {item.kind === 'comment'
                    ? `${t('comment')} - ${item.authorName ?? t('no_name')}`
                    : t('mention_in_ticket')}
                </span>
                <span className='shrink-0 font-mono'>{dayformat(item.at, 'tz-minute', tz)}</span>
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
export const MentionsWidgetName: FC = () => {
  const { t } = useLocale()
  return <>{t('my_mentions')}</>
}
