'use client'

import { CommandStatusChip } from '@/components/command/command-status-chip'
import { CommandLineIcon } from '@/components/icon'
import { useActionData } from '@/lib/action/action-client'
import { dayformat } from '@/lib/day'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { FC } from 'react'
import { getRecentCommandRuns } from '../server'
import { RowLink } from './ticket-row'
import { WidgetCard, WidgetFC, WidgetLoadError, WidgetRowList, WidgetSkeleton } from './widget-card'

/**
 * 自分が実行したリモート実行の最近の結果を表示する Widget。
 */
export const CommandRunsWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const { data, isLoading } = useActionData(getRecentCommandRuns)

  return (
    <WidgetCard id={id} editable={editable} icon={<CommandLineIcon />} title={t('command_runs_recent')}>
      {data ? (
        <WidgetRowList isEmpty={data.length === 0} message={t('msg_no_command_runs')}>
          {data.map((run) => (
            <RowLink key={run.id} href={`/commands/runs/${run.id}`} editable={editable}>
              <div className='flex min-w-0 items-center gap-2 text-sm'>
                <span className='truncate'>{run.commandLabel}</span>
                <span className='shrink-0 text-xs text-gray-500'>{run.targetLabel}</span>
              </div>
              <div className='flex items-center gap-2'>
                <CommandStatusChip status={run.status} />
                <span className='font-mono text-xs text-gray-500'>
                  {dayformat(run.finishedAt ?? run.queuedAt, 'tz-minute', tz)}
                </span>
              </div>
            </RowLink>
          ))}
        </WidgetRowList>
      ) : isLoading ? (
        <WidgetSkeleton />
      ) : (
        <WidgetLoadError />
      )}
    </WidgetCard>
  )
}
export const CommandRunsWidgetName: FC = () => {
  const { t } = useLocale()
  return <>{t('command_runs_recent')}</>
}
