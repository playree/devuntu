'use client'

import { Grid } from '@/components/general/grid'
import { ProgressBar } from '@/components/general/progress'
import { InformationCircleIcon } from '@/components/icon'
import { useActionData } from '@/lib/action/action-client'
import { calcPercent, formatByte } from '@/lib/math'
import { useLocale } from '@/locale/client'
import { getLinodeTransferInfo } from '../server'
import { WidgetDataCard, WidgetFC } from './widget-card'

/**
 * Linode Transfer情報を表示する Widget。
 * `LINODE_*` が未設定で Action が null を返した場合も、取得完了後は失敗として扱う。
 */
export const LinodeTransferInfoWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const { data, isLoading } = useActionData(getLinodeTransferInfo)

  return (
    <WidgetDataCard
      id={id}
      editable={editable}
      icon={<InformationCircleIcon />}
      title={t('linode_transfer_info')}
      className='h-full'
      data={data}
      isLoading={isLoading}
    >
      {(data) => (
        <Grid>
          <div className='col-span-4 text-sm'>{t('transfer_pool_usage')} :</div>
          <div className='col-span-8'>
            <ProgressBar progress={calcPercent(data.used, data.total)} aria-label={t('transfer_pool_usage')}>
              {formatByte(data.used)} / {data.quota}GiB
            </ProgressBar>
          </div>
          <div className='col-span-4 text-sm'>{t('transfer_billable')} :</div>
          <div className='col-span-8'>{data.billable}GiB</div>
        </Grid>
      )}
    </WidgetDataCard>
  )
}
