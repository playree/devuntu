'use client'

import { AccordionSection } from '@/components/general/accordion'
import { MultiButton } from '@/components/general/button'
import { useModalState } from '@/components/general/modal'
import { useServerPagingList } from '@/components/general/paging'
import { MultiTable, SelectionCell } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ChatBubbleIcon, FunnelIcon, PlusIcon, TicketIcon } from '@/components/icon'
import { ReloadButton } from '@/components/reload-button'
import { PriorityChip, StatusChip, TagChips, TicketIdText, useBoardName } from '@/components/ticket/ticket-chip'
import { parseAction } from '@/lib/action/action-client'
import { preventParentSelection } from '@/lib/client-utils'
import { dayformat } from '@/lib/day'
import { TicketSearch } from '@/lib/schema/schema'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { Accordion, Table } from '@heroui/react'
import Link from 'next/link'
import { FC, useEffect, useRef, useState } from 'react'
import { AddModal } from './modals'
import { defaultTicketFilter, TicketSearchPanel } from './search-panel'
import { getTickets } from './server'
import { TicketDrawerLayout } from './ticket-drawer-layout'
import { useTicketFormOptions } from './use-ticket-form'

const defaultExpandedKeys = new Set(['search'])

export const TicketsClient: FC<{
  /** URL の ?boardId= / ?status= / ?assignee= 由来の初期絞り込み。未指定の項目は既定の条件になる */
  initialFilter?: Partial<Pick<TicketSearch, 'boardId' | 'status' | 'assignee'>>
}> = ({ initialFilter }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const boardName = useBoardName()
  const addModalState = useModalState()

  // 詳細パネルに表示中のチケット。未選択なら undefined
  const [selectedId, setSelectedId] = useState<string>()
  const [filter, setFilter] = useState<TicketSearch>({
    ...defaultTicketFilter,
    boardId: initialFilter?.boardId ?? null,
    status: initialFilter?.status ?? defaultTicketFilter.status,
    assignee: initialFilter?.assignee ?? null,
  })
  // usePagingList の load は再生成されるため、最新の検索条件は ref から読む
  const filterRef = useRef(filter)
  const { options, reload: reloadOptions } = useTicketFormOptions()

  // ページ切り出し・並び替えはサーバー側。検索条件と合わせて 1 ページ分だけを取得する
  const list = useServerPagingList({
    loadPage: async (query) => {
      const res = await parseAction(getTickets({ ...filterRef.current, ...query }))
      return res ?? { items: [], total: 0 }
    },
    sort: { init: { column: 'updatedAt', direction: 'descending' } },
  })

  // applyFilter 以外から setFilter された場合でも ref がずれないようにする
  // (applyFilter は reload と同じターンで必要なので、そちらでも直接代入している)
  useEffect(() => {
    filterRef.current = filter
  }, [filter])

  const applyFilter = (next: TicketSearch) => {
    filterRef.current = next
    setFilter(next)
    // 条件が変われば件数も変わるため、前の条件でのページ位置を引き継がない
    list.resetPage()
    list.reload()
  }

  const reloadAll = () => {
    list.reload()
    reloadOptions()
  }

  return (
    <TicketDrawerLayout
      selectedId={selectedId}
      onClose={() => setSelectedId(undefined)}
      onChanged={reloadAll}
      formOptions={options}
    >
      <ContentHeader icon={<TicketIcon />} title={t('ticket')}>
        <MultiButton
          isIconOnly
          tooltip={t('add_ticket')}
          isDisabled={!options}
          icon={<PlusIcon />}
          onPress={() => addModalState.open()}
        />
        <ReloadButton onReload={reloadAll} />
      </ContentHeader>

      <Accordion allowsMultipleExpanded hideSeparator defaultExpandedKeys={defaultExpandedKeys}>
        <AccordionSection id='search' icon={<FunnelIcon />} title={t('filter')}>
          <TicketSearchPanel
            filter={filter}
            onChange={applyFilter}
            boards={(options?.boards ?? []).map((board) => ({ ...board, name: boardName(board) }))}
            tags={options?.tags ?? []}
            assignees={options?.assignees ?? []}
          />
        </AccordionSection>
      </Accordion>

      <MultiTable
        aria-label='ticket list'
        isSmart
        pagingList={list}
        selectionMode='single'
        selectionBehavior='toggle'
        selectedKeys={selectedId ? [selectedId] : []}
        onSelectionChange={(keys) => {
          // 'all' は単一選択では発生しないが、型の都合で除外する
          const next = keys === 'all' ? undefined : [...keys][0]
          setSelectedId(next === undefined ? undefined : String(next))
        }}
        columns={[
          // 番号順の並べ替えは持たない(TICKET_SORT_COLUMNS に無く、ボード横断では意味を成さないため)
          { id: 'displayId', name: t('id'), allowsSorting: false, minWidth: 80, defaultWidth: 90 },
          { id: 'title', name: t('title'), isRowHeader: true, allowsSorting: true, minWidth: 140, defaultWidth: '2fr' },
          // 幅は一番長いラベル(バックログ)の StatusChip がセルの左右パディング込みで折り返さない値にする
          { id: 'status', name: t('status'), allowsSorting: true, minWidth: 120, defaultWidth: 120 },
          { id: 'priority', name: t('priority'), allowsSorting: true, minWidth: 70, defaultWidth: 70 },
          { id: 'assigneeName', name: t('assignee'), allowsSorting: true, minWidth: 100, defaultWidth: 100 },
          { id: 'dueDate', name: t('due_date'), allowsSorting: true, minWidth: 110, defaultWidth: 110 },
          { id: 'tags', name: t('tags'), allowsSorting: false, minWidth: 100 },
          { id: 'updatedAt', name: t('updated_at'), allowsSorting: true, minWidth: 110, defaultWidth: 110 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <SelectionCell />
            <Table.Cell>
              <TicketIdText displayId={item.displayId} />
            </Table.Cell>
            <Table.Cell>
              <div className='flex flex-col gap-0.5'>
                <Link
                  /**
                   * 件名を詳細ページへのリンクにする(新規タブや URL コピーを可能にするため)。
                   * 行選択が同時に走ると遷移直前に詳細パネルが一瞬見えるので抑止する
                   */
                  href={`/tickets/${item.id}`}
                  className='truncate hover:underline'
                  {...preventParentSelection}
                >
                  {item.title}
                </Link>
                <span className='flex items-center gap-2 text-xs text-gray-500'>
                  {boardName({ name: item.boardName, kind: item.boardKind })}
                  {item.commentCount > 0 && (
                    <span className='flex items-center gap-0.5'>
                      <ChatBubbleIcon width={12} />
                      {item.commentCount}
                    </span>
                  )}
                </span>
              </div>
            </Table.Cell>
            <Table.Cell>
              <StatusChip value={item.status} />
            </Table.Cell>
            <Table.Cell>
              <PriorityChip value={item.priority} />
            </Table.Cell>
            <Table.Cell className='truncate'>{item.assigneeName}</Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.dueDate, 'date')}</Table.Cell>
            <Table.Cell>
              <TagChips tags={item.tags} />
            </Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.updatedAt, 'tz-simple', tz)}</Table.Cell>
          </Table.Row>
        )}
      </MultiTable>

      {options && (
        <AddModal
          state={addModalState}
          reload={reloadAll}
          key={addModalState.key}
          options={options}
          defaultBoardId={filter.boardId}
        />
      )}
    </TicketDrawerLayout>
  )
}
