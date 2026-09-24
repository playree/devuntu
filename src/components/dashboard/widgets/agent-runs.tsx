'use client'

import { AgentRunStatusChip } from '@/components/agent/agent-run-history'
import { CpuChipIcon } from '@/components/icon'
import { useActionData } from '@/lib/action/action-client'
import { AGENT_RUN_ACTION_LOCALE } from '@/lib/agent/agent'
import { dayformat } from '@/lib/day'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { FC } from 'react'
import { getRecentAgentRuns } from '../server'
import { RowLink } from './ticket-row'
import { WidgetCard, WidgetFC, WidgetLoadError, WidgetRowList, WidgetSkeleton } from './widget-card'

/**
 * 自分が承認者になっているエージェントの最近の実行を表示する Widget。
 */
export const AgentRunsWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const { data, isLoading } = useActionData(getRecentAgentRuns)

  return (
    <WidgetCard id={id} editable={editable} icon={<CpuChipIcon />} title={t('agent_runs_recent')}>
      {data ? (
        <WidgetRowList isEmpty={data.length === 0} message={t('msg_no_agent_runs')}>
          {data.map((run) => (
            <RowLink key={run.id} href='/agents' editable={editable}>
              <div className='flex min-w-0 items-center gap-2 text-sm'>
                <span className='shrink-0 font-mono text-xs'>{run.ticketRef ?? '-'}</span>
                <span className='truncate'>{run.agentName}</span>
                <span className='shrink-0 text-xs text-gray-500'>{t(AGENT_RUN_ACTION_LOCALE[run.action])}</span>
              </div>
              <div className='flex items-center gap-2'>
                <AgentRunStatusChip status={run.status} />
                <span className='font-mono text-xs text-gray-500'>{dayformat(run.startedAt, 'tz-minute', tz)}</span>
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
export const AgentRunsWidgetName: FC = () => {
  const { t } = useLocale()
  return <>{t('agent_runs_recent')}</>
}
