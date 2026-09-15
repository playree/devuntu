'use client'

import { CommandStatusChip } from '@/components/command/command-status-chip'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useServerPagingList } from '@/components/general/paging'
import { SwitchField } from '@/components/general/switch'
import { MultiTable, TruncatedCell } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, ClockIcon } from '@/components/icon'
import { parseAction } from '@/lib/action/action-client'
import { authClient } from '@/lib/auth/auth-client'
import { COMMAND_RUN_ROWS_PER_PAGE } from '@/lib/command/command'
import { dayformat } from '@/lib/day'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { Table } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC, useRef, useState } from 'react'
import { getCommandRunsAction } from '../server'

/**
 * コマンドの実行履歴。
 *
 * 件数が積み上がるのでサーバー側ページング。管理者は「全員の実行」に切り替えられる。
 */
export const CommandRunsClient: FC = () => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const router = useRouter()
  const { data: session } = authClient.useSession()
  const isAdmin = session?.user.role === 'admin'

  const [showAll, setShowAll] = useState(false)
  // loadPage は毎レンダリング作り直されるため、絞り込み条件は ref から読む
  const showAllRef = useRef(false)

  const list = useServerPagingList({
    loadPage: async (query) => {
      const res = await parseAction(
        getCommandRunsAction({ scope: showAllRef.current && isAdmin ? 'all' : 'mine', ...query }),
      )
      return res ?? { items: [], total: 0 }
    },
    sort: { init: { column: 'queuedAt', direction: 'descending' } },
    rowsPerPage: COMMAND_RUN_ROWS_PER_PAGE,
  })

  return (
    <FlexCol>
      <ContentHeader
        icon={<ClockIcon />}
        title={t('command_run_history')}
        extra={
          isAdmin && (
            <SwitchField
              isSmart
              id='command-runs-scope'
              label={t('command_run_scope_all')}
              isSelected={showAll}
              onChange={(selected) => {
                showAllRef.current = selected
                setShowAll(selected)
                // 条件が変われば件数も変わるため、前の条件でのページ位置は引き継がない
                list.resetPage()
                list.reload()
              }}
            />
          )
        }
      >
        <MultiButton isIconOnly tooltip={t('reload')} onPress={() => list.reload()}>
          <ArrowPathIcon />
        </MultiButton>
      </ContentHeader>

      <MultiTable
        isSmart
        ariaLabel='command run list'
        pagingList={list}
        columns={[
          {
            id: 'commandLabel',
            name: t('command_definition'),
            isRowHeader: true,
            allowsSorting: true,
            minWidth: 120,
            defaultWidth: '2fr',
          },
          { id: 'argsPreview', name: t('command_run_args'), minWidth: 120, defaultWidth: '2fr' },
          { id: 'status', name: t('status'), allowsSorting: true, minWidth: 80, defaultWidth: 90 },
          { id: 'userName', name: t('command_executed_by'), allowsSorting: true, minWidth: 90 },
          { id: 'queuedAt', name: t('command_run_queued_at'), allowsSorting: true, minWidth: 115 },
          { id: 'finishedAt', name: t('command_run_finished_at'), allowsSorting: true, minWidth: 115 },
        ]}
      >
        {(item) => (
          <Table.Row
            key={item.id}
            id={item.id}
            className='cursor-pointer'
            onAction={() => router.push(`/commands/runs/${item.id}`)}
          >
            <Table.Cell className='truncate'>{item.commandLabel}</Table.Cell>
            <TruncatedCell className='font-mono text-xs' value={item.argsPreview} />
            <Table.Cell>
              <CommandStatusChip status={item.status} />
            </Table.Cell>
            <Table.Cell className='truncate'>{item.userName}</Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.queuedAt, 'tz-minute', tz)}</Table.Cell>
            <Table.Cell className='font-mono text-xs'>
              {item.finishedAt ? dayformat(item.finishedAt, 'tz-minute', tz) : ''}
            </Table.Cell>
          </Table.Row>
        )}
      </MultiTable>
    </FlexCol>
  )
}
