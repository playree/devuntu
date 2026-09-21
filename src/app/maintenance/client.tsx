'use client'

import { FlexCol } from '@/components/general/flex'
import { WrenchIcon } from '@/components/icon'
import { SingleLayout } from '@/components/single-layout'
import { textStyles } from '@/lib/style'
import { useLocale } from '@/locale/client'
import { FC } from 'react'

export const MaintenanceClient: FC = () => {
  const { t } = useLocale()
  const { light } = textStyles()

  return (
    <SingleLayout icon={<WrenchIcon />} title={t('maintenance_mode')}>
      <FlexCol className='gap-2 px-2 py-4 text-center'>
        <div className={light({ className: 'text-sm whitespace-pre-line' })}>{t('msg_maintenance_mode')}</div>
      </FlexCol>
    </SingleLayout>
  )
}
