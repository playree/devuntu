'use client'

import { createEnumChip } from '@/components/enum-chip'
import { PagingList } from '@/components/general/paging'
import { MultiTable, TruncatedCell } from '@/components/general/table'
import type { AgentRunStatus } from '@/generated/prisma/enums'
import { AGENT_RUN_ACTION_LOCALE, AGENT_RUN_STATUS_LOCALE, agentRunDuration } from '@/lib/agent/agent'
import type { AgentRunSummary } from '@/lib/agent/agent-runner-config'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { useLocale } from '@/locale/client'
import { Table } from '@heroui/react'
import Link from 'next/link'
import { FC } from 'react'

/** 結果の配色。実行中は結果が確定していないので既定色のまま出す */
export const AgentRunStatusChip = createEnumChip<AgentRunStatus>({
  running: { item: AGENT_RUN_STATUS_LOCALE.running, color: 'default' },
  succeeded: { item: AGENT_RUN_STATUS_LOCALE.succeeded, color: 'success' },
  failed: { item: AGENT_RUN_STATUS_LOCALE.failed, color: 'danger' },
  skipped: { item: AGENT_RUN_STATUS_LOCALE.skipped, color: 'warning' },
}).EnumChip

/**
 * 自動運用の実行履歴。
 *
 * 件数が増え続けるので、サーバー側で新しい順に上限まで絞ってから返している(`getAgentRuns`)。
 * ページングはその範囲内でクライアント側で行う。ヘッダーの更新ボタンと合わせてリロードできるよう、
 * `usePagingList` の呼び出しは親(client.tsx)側で行い、ここでは結果だけを受け取る。
 */
export const AgentRunHistory: FC<{ pagingList: PagingList<AgentRunSummary> }> = ({ pagingList }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()

  return (
    <MultiTable
      isSmart
      aria-label='agent run list'
      pagingList={pagingList}
      columns={[
        { id: 'ticketRef', name: t('ticket'), isRowHeader: true, allowsSorting: true, minWidth: 90, defaultWidth: 100 },
        { id: 'action', name: t('action'), allowsSorting: true, minWidth: 100, defaultWidth: 110 },
        { id: 'status', name: t('status'), allowsSorting: true, minWidth: 90, defaultWidth: 100 },
        { id: 'startedAt', name: t('agent_started_at'), allowsSorting: true, minWidth: 120, defaultWidth: 130 },
        { id: 'duration', name: t('agent_duration'), minWidth: 80, defaultWidth: 90 },
        { id: 'summary', name: t('content'), minWidth: 140, defaultWidth: '2fr' },
      ]}
    >
      {(item) => (
        <Table.Row key={item.id} id={item.id}>
          <Table.Cell className='font-mono text-xs'>
            {item.ticketId && item.ticketRef ? (
              <Link // 短縮 URL(/t/[displayId])はボードのメンバーしか辿れないため、承認者でも開ける詳細ページへ直接リンクする
                className='hover:underline'
                href={`/tickets/${item.ticketId}`}
              >
                {item.ticketRef}
              </Link>
            ) : (
              (item.ticketRef ?? '-')
            )}
          </Table.Cell>
          <Table.Cell className='whitespace-nowrap'>{t(AGENT_RUN_ACTION_LOCALE[item.action])}</Table.Cell>
          <Table.Cell>
            <AgentRunStatusChip value={item.status} />
          </Table.Cell>
          <Table.Cell className='font-mono text-xs'>{dayformat(item.startedAt, 'tz-minute', tz)}</Table.Cell>
          <Table.Cell className='font-mono text-xs'>{agentRunDuration(item.startedAt, item.finishedAt)}</Table.Cell>
          <TruncatedCell value={item.summary ?? ''} />
        </Table.Row>
      )}
    </MultiTable>
  )
}
