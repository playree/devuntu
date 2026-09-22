'use client'

import { FlexCol } from '@/components/general/flex'
import { ExclamationTriangleIcon } from '@/components/icon'
import { SingleLayout } from '@/components/single-layout'
import { useLocale } from '@/locale/client'
import { FC } from 'react'

export const MaintenanceClient: FC = () => {
  const { t } = useLocale()

  return (
    <SingleLayout icon={<ExclamationTriangleIcon />} title={t('maintenance_mode')}>
      <FlexCol className='gap-2 px-2 py-4 text-center'>
        <div className='whitespace-pre-line'>{t('msg_maintenance_mode')}</div>
      </FlexCol>
    </SingleLayout>
  )
}
