'use client'

import { Grid } from '@/components/general/grid'
import { InformationCircleIcon } from '@/components/icon'
import { useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { getAppInfo } from '../server'
import { WidgetDataCard, WidgetFC } from './widget-card'

/**
 * アプリのバージョン・ビルド番号を表示する Widget。
 */
export const AppInfoWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const { data, isLoading } = useActionData(getAppInfo)

  return (
    <WidgetDataCard
      id={id}
      editable={editable}
      icon={<InformationCircleIcon />}
      title={t('app_info')}
      className='h-full'
      data={data}
      isLoading={isLoading}
    >
      {(data) => (
        <Grid>
          <div className='col-span-4 text-sm'>{t('version')} :</div>
          <div className='col-span-8'>{data.version}</div>
          <div className='col-span-4 text-sm'>{t('buildno')} :</div>
          <div className='col-span-8'>{data.buildno}</div>
        </Grid>
      )}
    </WidgetDataCard>
  )
}
