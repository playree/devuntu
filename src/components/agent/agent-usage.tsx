'use client'

import { MetaRow } from '@/components/general/meta-row'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { useBoardName } from '@/components/ticket/ticket-options'
import { AGENT_UNLIMITED_MONTHLY_BUDGET, formatTokens, formatUsd } from '@/lib/agent/agent'
import type { AgentMonthlyUsage, AgentUsageTotal } from '@/lib/agent/agent-usage'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { useLocale } from '@/locale/client'
import { FC } from 'react'

const tokensLabel = (usage: AgentUsageTotal) =>
  `${formatTokens(usage.inputTokens)} / ${formatTokens(usage.outputTokens)}`

/**
 * 今月の利用量(コスト・トークン数)と、ボード別の内訳。
 *
 * 予算上限は自動運用の設定側で持つので、呼び出し側から渡してもらう(未設定・無制限は 0)。
 */
export const AgentUsage: FC<{
  usage: AgentMonthlyUsage | null | undefined
  budgetUsd: number | undefined
  isLoading: boolean
}> = ({ usage, budgetUsd, isLoading }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const boardName = useBoardName()

  if (isLoading) {
    return <PanelSkeleton />
  }

  const budget =
    !budgetUsd || budgetUsd === AGENT_UNLIMITED_MONTHLY_BUDGET ? t('agent_unlimited') : formatUsd(budgetUsd)

  return (
    <div className='space-y-3'>
      <NoticePanel className='text-xs'>{t('msg_agent_usage_desc')}</NoticePanel>

      {!usage ? (
        <p className='text-muted text-sm'>{t('msg_no_agent_usage')}</p>
      ) : (
        <>
          <div className='space-y-1'>
            <MetaRow label={t('agent_monthly_usage')}>
              <span className='font-mono'>{`${formatUsd(usage.total.costUsd)} / ${budget}`}</span>
            </MetaRow>
            <MetaRow label={t('agent_usage_runs')}>
              <span className='font-mono'>{usage.total.runs}</span>
            </MetaRow>
            <MetaRow label={t('agent_tokens')}>
              <span className='font-mono'>{tokensLabel(usage.total)}</span>
            </MetaRow>
            <MetaRow label={t('agent_usage_reset')}>
              <span className='font-mono'>{dayformat(usage.resetAt, 'tz-minute', tz)}</span>
            </MetaRow>
          </div>

          {usage.boards.length > 0 && (
            <ul // ボード別の内訳。列幅の揃った表にすると狭い画面で横スクロールになるので、1行に収まる範囲で並べる
              aria-label={t('board')}
              className='divide-y rounded-lg border text-sm'
            >
              {usage.boards.map((row) => (
                <li key={row.board?.id ?? ''} className='flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5'>
                  <span className='min-w-0 flex-1 truncate'>
                    {row.board ? boardName(row.board) : <span className='text-muted'>{t('board_deleted')}</span>}
                  </span>
                  <span className='text-muted font-mono text-xs'>{`${t('agent_usage_runs')} ${row.runs}`}</span>
                  <span className='text-muted font-mono text-xs'>{tokensLabel(row)}</span>
                  <span className='w-20 text-right font-mono'>{formatUsd(row.costUsd)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
