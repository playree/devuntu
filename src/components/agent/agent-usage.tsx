'use client'

import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { MultiTable } from '@/components/general/table'
import { useBoardName } from '@/components/ticket/ticket-options'
import { AGENT_UNLIMITED_MONTHLY_BUDGET, formatTokens, formatUsd } from '@/lib/agent/agent'
import type { AgentBoardUsage, AgentMonthlyUsage, AgentUsageTotal } from '@/lib/agent/agent-usage'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { useLocale } from '@/locale/client'
import { cn, Table } from '@heroui/react'
import { FC, ReactNode } from 'react'

/** 表の1行。ボード別の行と、末尾の合計行(board を持たない)を同じ列で並べる */
type UsageRow = AgentUsageTotal & { id: string; board?: AgentBoardUsage['board']; isTotal?: boolean }

const TOTAL_ROW_ID = 'total'
const DELETED_BOARD_ROW_ID = 'deleted'

const tokensLabel = (usage: AgentUsageTotal) =>
  `${formatTokens(usage.inputTokens)} / ${formatTokens(usage.outputTokens)}`

const SummaryItem: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <span className='flex items-baseline gap-2'>
    <span className='text-muted text-xs'>{label}</span>
    <span className='font-mono'>{children}</span>
  </span>
)

/**
 * 今月の利用量(コスト・トークン数)を、ボード別の内訳と合計の表で出す。
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

  const rows: UsageRow[] = usage
    ? [
        ...usage.boards.map((row) => ({ ...row, id: row.board?.id ?? DELETED_BOARD_ROW_ID })),
        { ...usage.total, id: TOTAL_ROW_ID, isTotal: true },
      ]
    : []

  return (
    <div className='space-y-3'>
      <NoticePanel className='text-xs'>{t('msg_agent_usage_desc')}</NoticePanel>

      {!usage ? (
        <p className='text-muted text-sm'>{t('msg_no_agent_usage')}</p>
      ) : (
        <>
          <div className='flex flex-wrap gap-x-6 gap-y-1 text-sm'>
            <SummaryItem label={t('agent_budget')}>{budget}</SummaryItem>
            <SummaryItem label={t('agent_usage_reset')}>{dayformat(usage.resetAt, 'tz-minute', tz)}</SummaryItem>
          </div>

          <MultiTable
            isSmart
            aria-label={t('agent_usage')}
            items={rows}
            columns={[
              { id: 'board', name: t('board'), isRowHeader: true, minWidth: 120, defaultWidth: '2fr' },
              { id: 'runs', name: t('agent_usage_runs'), minWidth: 70, defaultWidth: '1fr' },
              { id: 'tokens', name: t('agent_tokens'), minWidth: 130, defaultWidth: '1fr' },
              { id: 'costUsd', name: t('agent_cost'), minWidth: 80, defaultWidth: '1fr' },
            ]}
          >
            {(row) => (
              <Table.Row key={row.id} id={row.id} className={cn(row.isTotal && 'font-semibold')}>
                <Table.Cell className='truncate'>
                  {row.isTotal ? (
                    t('total')
                  ) : row.board ? (
                    boardName(row.board)
                  ) : (
                    <span className='text-muted'>{t('board_deleted')}</span>
                  )}
                </Table.Cell>
                <Table.Cell className='font-mono text-xs'>{row.runs}</Table.Cell>
                <Table.Cell className='font-mono text-xs whitespace-nowrap'>{tokensLabel(row)}</Table.Cell>
                <Table.Cell className='font-mono text-xs'>{formatUsd(row.costUsd)}</Table.Cell>
              </Table.Row>
            )}
          </MultiTable>
        </>
      )}
    </div>
  )
}
