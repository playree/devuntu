'use client'

import { ChatBubbleIcon } from '@/components/icon'
import { useActionData } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { useLocale } from '@/locale/client'
import { getMentions } from '../server'
import { RowLink, TicketTitleLine } from './ticket-row'
import { WidgetDataCard, WidgetFC, WidgetRowList } from './widget-card'

/**
 * 自分宛てのメンション(チケット本文・コメント)を新しい順に表示する Widget。
 */
export const MentionsWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const { data, isLoading } = useActionData(getMentions)

  return (
    <WidgetDataCard
      id={id}
      editable={editable}
      icon={<ChatBubbleIcon />}
      title={t('my_mentions')}
      data={data}
      isLoading={isLoading}
    >
      {(data) => (
        <WidgetRowList isEmpty={data.length === 0} message={t('msg_no_mentions')}>
          {data.map((item) => (
            <RowLink key={item.key} href={item.href} editable={editable}>
              <TicketTitleLine ticket={item.ticket} />
              <div className='text-muted flex min-w-0 items-center gap-2 text-xs'>
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
      )}
    </WidgetDataCard>
  )
}
