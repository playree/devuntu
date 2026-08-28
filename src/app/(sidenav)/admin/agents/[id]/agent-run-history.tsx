'use client'

import { PagingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { AGENT_RUN_ACTION_LOCALE, AGENT_RUN_STATUS_LOCALE } from '@/lib/agent'
import { dayformat } from '@/lib/day'
import { ticketShortPath } from '@/lib/task'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { Chip, Table } from '@heroui/react'
import Link from 'next/link'
import { FC } from 'react'
import { GetAgentRunsReturnType } from './server'

type AgentRun = NonNullable<GetAgentRunsReturnType>[number]

/** 結果の配色。実行中は結果が確定していないので既定色のまま出す */
const STATUS_COLOR = {
  running: 'default',
  succeeded: 'success',
  failed: 'danger',
  skipped: 'warning',
} as const

/** 所要時間。分と秒だけで足りるので mm:ss で出す */
const duration = (startedAt: Date, finishedAt: Date | null): string => {
  if (!finishedAt) {
    return '-'
  }
  const sec = Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000))
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
}

/**
 * 自動運用の実行履歴。
 *
 * 件数が増え続けるので、サーバー側で新しい順に上限まで絞ってから返している(`getAgentRuns`)。
 * ページングはその範囲内でクライアント側で行う。ヘッダーの更新ボタンと合わせてリロードできるよう、
 * `usePagingList` の呼び出しは親(client.tsx)側で行い、ここでは結果だけを受け取る。
 */
export const AgentRunHistory: FC<{ pagingList: PagingList<AgentRun> }> = ({ pagingList }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()

  return (
    <MultiTable
      isSmart
      ariaLabel='agent run list'
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
              <Link className='hover:underline' href={ticketShortPath(item.ticketRef)}>
                {item.ticketRef}
              </Link>
            ) : (
              (item.ticketRef ?? '-')
            )}
          </Table.Cell>
          <Table.Cell className='whitespace-nowrap'>{t(AGENT_RUN_ACTION_LOCALE[item.action])}</Table.Cell>
          <Table.Cell>
            <Chip color={STATUS_COLOR[item.status]} variant='soft' className='whitespace-nowrap'>
              {t(AGENT_RUN_STATUS_LOCALE[item.status])}
            </Chip>
          </Table.Cell>
          <Table.Cell className='font-mono text-xs'>{dayformat(item.startedAt, 'tz-simple', tz)}</Table.Cell>
          <Table.Cell className='font-mono text-xs'>{duration(item.startedAt, item.finishedAt)}</Table.Cell>
          <Table.Cell className='truncate'>{item.summary ?? ''}</Table.Cell>
        </Table.Row>
      )}
    </MultiTable>
  )
}
