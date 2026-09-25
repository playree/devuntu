'use client'

import { InformationCircleIcon } from '@/components/icon'
import { MarkdownView } from '@/components/markdown/markdown-view'
import { useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { getAnnouncement } from '../server'
import { WidgetDataCard, WidgetFC } from './widget-card'

/**
 * お知らせ Widget。管理ページで編集された Markdown を表示する。
 */
export const AnnouncementWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const { data, isLoading } = useActionData(getAnnouncement)

  return (
    <WidgetDataCard
      id={id}
      editable={editable}
      icon={<InformationCircleIcon />}
      title={t('announcement')}
      data={data}
      isLoading={isLoading}
    >
      {(data) => (
        <div className='max-h-80 min-h-14 flex-1 overflow-y-auto'>
          <MarkdownView body={data.body} />
        </div>
      )}
    </WidgetDataCard>
  )
}
