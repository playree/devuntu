'use client'

import { FlexCol } from '@/components/general/flex'
import { NoticePanel } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { CalendarDaysIcon } from '@/components/icon'
import { useLocale } from '@/locale/client'
import { FC } from 'react'

/**
 * Google連携が無効で共有カレンダーが利用できない場合の表示
 */
export const CalUnavailable: FC = () => {
  const { t } = useLocale()
  return (
    <FlexCol>
      <ContentHeader icon={<CalendarDaysIcon />} title={t('calendar_share')} />
      <NoticePanel>{t('msg_feature_unavailable')}</NoticePanel>
    </FlexCol>
  )
}
