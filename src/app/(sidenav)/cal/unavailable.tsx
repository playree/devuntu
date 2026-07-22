'use client'

import { FlexCol } from '@/components/general/flex'
import { ContentHeader } from '@/components/header'
import { CalendarDaysIcon } from '@/components/icon'
import { useLocale } from '@/locale/client'
import { Card } from '@heroui/react'
import { FC } from 'react'

/**
 * Google連携が無効で共有カレンダーが利用できない場合の表示
 */
export const CalUnavailable: FC = () => {
  const { t } = useLocale()
  return (
    <FlexCol>
      <ContentHeader icon={<CalendarDaysIcon />} title={t('calendar_share')} />
      <Card>
        <Card.Content className='p-4'>
          <p className='text-sm text-neutral-500'>{t('msg_feature_unavailable')}</p>
        </Card.Content>
      </Card>
    </FlexCol>
  )
}
