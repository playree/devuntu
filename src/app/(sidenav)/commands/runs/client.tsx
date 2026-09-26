'use client'

import { CommandStatusChip } from '@/components/command/command-status-chip'
import { MultiButton } from '@/components/general/button'
import { FlexCol, FlexRow } from '@/components/general/flex'
import { useServerPagingList } from '@/components/general/paging'
import { SwitchField } from '@/components/general/switch'
import { MultiTable, TruncatedCell } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ClockIcon, XMarkIcon } from '@/components/icon'
import { ReloadButton } from '@/components/reload-button'
import { parseAction } from '@/lib/action/action-client'
import { authClient } from '@/lib/auth/auth-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { COMMAND_RUN_ROWS_PER_PAGE } from '@/lib/command/command'
import { dayformat } from '@/lib/day'
import { useLocale } from '@/locale/client'
import { Chip, Table } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC, useRef, useState } from 'react'
import { getCommandRuns } from '../server'

/**
 * コマンドの実行履歴。
 *
 * 件数が積み上がるのでサーバー側ページング。管理者は「全員の実行」に切り替えられる。
 * `initialCommandKey` が渡されたときはそのコマンドだけを出す(リモート実行のカードからの導線)。
 */
export const CommandRunsClient: FC<{ initialCommandKey: string | null }> = ({ initialCommandKey }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const router = useRouter()
  const { data: session } = authClient.useSession()
  const isAdmin = session?.user.role === 'admin'

  const [showAll, setShowAll] = useState(false)
  // 絞り込みは URL の初期値を引き継ぐだけで、以降は画面の状態として持つ(URL は書き換えない)
  const [commandKey, setCommandKey] = useState(initialCommandKey)
  // loadPage は毎レンダリング作り直されるため、絞り込み条件は ref から読む
  const showAllRef = useRef(false)
  const commandKeyRef = useRef(initialCommandKey)

  const list = useServerPagingList({
    loadPage: async (query) => {
      return await parseAction(
        getCommandRuns({
          scope: showAllRef.current && isAdmin ? 'all' : 'mine',
          commandKey: commandKeyRef.current,
          ...query,
        }),
      )
    },
    sort: { init: { column: 'queuedAt', direction: 'descending' } },
    rowsPerPage: COMMAND_RUN_ROWS_PER_PAGE,
  })

  /**
   * 絞り込み中の見出しに出す名前。
   * 定義から引かず行の値を使うのは、アサインされていないコマンドの表示名を
   * URL を打つだけで引き出せてしまうのを避けるため(行は権限で絞られている)
   */
  const commandLabel = list.items[0]?.commandLabel ?? commandKey

  return (
    <FlexCol>
      <ContentHeader
        icon={<ClockIcon />}
        title={t('command_run_history')}
        extra={
          <>
            {commandKey && (
              <FlexRow className='min-w-0 items-center gap-1'>
                <Chip variant='soft' className='min-w-0'>
                  <Chip.Label className='truncate'>{commandLabel}</Chip.Label>
                </Chip>
                <MultiButton
                  isIconOnly
                  size='sm'
                  variant='ghost'
                  tooltip={t('clear')}
                  icon={<XMarkIcon />}
                  onPress={() => {
                    commandKeyRef.current = null
                    setCommandKey(null)
                    list.resetPage()
                    list.reload()
                  }}
                />
              </FlexRow>
            )}
            {isAdmin && (
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
            )}
          </>
        }
      >
        <ReloadButton onReload={list.reload} hasSeparator={false} />
      </ContentHeader>

      <MultiTable
        isSmart
        aria-label='command run list'
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
              <CommandStatusChip value={item.status} />
            </Table.Cell>
            <Table.Cell className='truncate'>{item.userName}</Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.queuedAt, 'tz-minute', tz)}</Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.finishedAt, 'tz-minute', tz) || '-'}</Table.Cell>
          </Table.Row>
        )}
      </MultiTable>
    </FlexCol>
  )
}
