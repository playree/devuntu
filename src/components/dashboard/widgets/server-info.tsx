'use client'

import { Grid } from '@/components/general/grid'
import { ProgressBar } from '@/components/general/progress'
import { InformationCircleIcon } from '@/components/icon'
import { useActionData } from '@/lib/action/action-client'
import { calcPercent, formatByte, formatTime } from '@/lib/math'
import { useLocale } from '@/locale/client'
import { getServerInfo } from '../server'
import { WidgetDataCard, WidgetFC } from './widget-card'

/**
 * サーバーの空きメモリ・稼働時間を表示する Widget。
 */
export const ServerInfoWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const { data, isLoading } = useActionData(getServerInfo)

  return (
    <WidgetDataCard
      id={id}
      editable={editable}
      icon={<InformationCircleIcon />}
      title={t('server_info')}
      className='h-full'
      data={data}
      isLoading={isLoading}
    >
      {(data) => (
        <Grid>
          <div className='col-span-4 text-sm'>{t('free_memory')} :</div>
          <div className='col-span-8'>
            <ProgressBar progress={calcPercent(data.memory.free, data.memory.total)} aria-label={t('free_memory')}>
              {formatByte(data.memory.free)} / {formatByte(data.memory.total)}
            </ProgressBar>
          </div>
          <div className='col-span-4 text-sm'>{t('uptime')} :</div>
          <div className='col-span-8'>{formatTime(data.uptime)}</div>
        </Grid>
      )}
    </WidgetDataCard>
  )
}
