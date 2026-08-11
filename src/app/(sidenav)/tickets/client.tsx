'use client'

import { AccordionSection } from '@/components/general/accordion'
import { MultiButton } from '@/components/general/button'
import { SideDrawer } from '@/components/general/drawer'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { useServerPagingList } from '@/components/general/paging'
import { MultiTable, SelectionCell } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, ChatBubbleIcon, FunnelIcon, PlusIcon, TicketIcon } from '@/components/icon'
import { PriorityChip, StatusChip, TagChips, TicketIdText, useBoardName } from '@/components/ticket/ticket-chip'
import { parseAction } from '@/lib/action-client'
import { dayformat } from '@/lib/day'
import { TicketSearch } from '@/lib/schema'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { Accordion, ButtonGroup, cn, Table } from '@heroui/react'
import Link from 'next/link'
import {
  FC,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { TicketDetailClient } from './[id]/client'
import { AddModal } from './modals'
import { defaultTicketFilter, TicketSearchPanel } from './search-panel'
import { getTicketFormOptions, GetTicketFormOptionsReturnType, getTickets } from './server'

const defaultExpandedKeys = new Set(['search'])

/**
 * 行内のリンクを押したときに行選択(詳細パネル)を起こさないためのハンドラ。
 * 行の押下判定は pointerdown / keydown 起点なので、リンク側でイベントを止める。
 */
const preventRowSelection = {
  onPointerDown: (e: ReactPointerEvent) => e.stopPropagation(),
  onClick: (e: ReactMouseEvent) => e.stopPropagation(),
  onKeyDown: (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation()
    }
  },
}

export const TicketsClient: FC<{
  /** URL の ?boardId= 由来の初期絞り込み対象。null = すべてのボード */
  initialBoardId?: string | null
}> = ({ initialBoardId }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const boardName = useBoardName()
  const addModalState = useModalState()

  // 詳細パネルに表示中のチケット。未選択なら undefined
  const [selectedId, setSelectedId] = useState<string>()
  const [filter, setFilter] = useState<TicketSearch>({ ...defaultTicketFilter, boardId: initialBoardId ?? null })
  // usePagingList の load は再生成されるため、最新の検索条件は ref から読む
  const filterRef = useRef(filter)
  const [options, setOptions] = useState<GetTicketFormOptionsReturnType>()

  // ページ切り出し・並び替えはサーバー側。検索条件と合わせて 1 ページ分だけを取得する
  const list = useServerPagingList({
    loadPage: async (query) => {
      const res = await parseAction(getTickets({ ...filterRef.current, ...query }))
      return res ?? { items: [], total: 0 }
    },
    sort: { init: { column: 'updatedAt', direction: 'descending' } },
  })

  const loadOptions = () => {
    parseAction(getTicketFormOptions())
      .then(setOptions)
      .catch(() => setOptions(undefined))
  }

  useEffect(() => {
    loadOptions()
  }, [])

  // applyFilter 以外から setFilter された場合でも ref がずれないようにする
  // (applyFilter は reload と同じターンで必要なので、そちらでも直接代入している)
  useEffect(() => {
    filterRef.current = filter
  }, [filter])

  // Escape で詳細パネルを閉じる。
  // モーダルやポップオーバーが処理済みの Escape(defaultPrevented)と、
  // 入力中の Escape は入力内容を失わせないため無視する。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) {
        return
      }
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, [contenteditable="true"]')) {
        return
      }
      setSelectedId(undefined)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const applyFilter = (next: TicketSearch) => {
    filterRef.current = next
    setFilter(next)
    // 条件が変われば件数も変わるため、前の条件でのページ位置を引き継がない
    list.resetPage()
    list.reload()
  }

  const reloadAll = () => {
    list.reload()
    loadOptions()
  }

  return (
    // 詳細パネルを開いている間は data-nav-hidden でサイドメニューを隠し、横幅を稼ぐ。
    // あわせて中央寄せ(mx-auto)をやめて左に寄せ、右のパネルと重なりにくくする
    <FlexCol
      data-wide
      data-nav-hidden={selectedId ? '' : undefined}
      className={cn('max-w-6xl', !selectedId && 'mx-auto')}
    >
      <ContentHeader icon={<TicketIcon />} title={t('ticket')}>
        <MultiButton isIconOnly tooltip={t('add_ticket')} isDisabled={!options} onPress={() => addModalState.open()}>
          <PlusIcon />
        </MultiButton>
        <MultiButton isIconOnly tooltip={t('reload')} onPress={reloadAll}>
          <ButtonGroup.Separator />
          <ArrowPathIcon />
        </MultiButton>
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
        ariaLabel='ticket list'
        isCompact
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
          { id: 'status', name: t('status'), allowsSorting: true, minWidth: 100, defaultWidth: 100 },
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
                  {...preventRowSelection}
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
              <StatusChip status={item.status} />
            </Table.Cell>
            <Table.Cell>
              <PriorityChip priority={item.priority} />
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

      <SideDrawer isOpen={!!selectedId} ariaLabel={t('ticket')} className='bg-background border-l p-4 shadow-2xl'>
        {selectedId && (
          <TicketDetailClient
            // id が変わっても useActionData は再取得しないため、選択のたびに作り直す
            key={selectedId}
            id={selectedId}
            onClose={() => setSelectedId(undefined)}
            onChanged={reloadAll}
          />
        )}
      </SideDrawer>

      {options && (
        <AddModal
          state={addModalState}
          reload={reloadAll}
          key={addModalState.key}
          options={options}
          defaultBoardId={filter.boardId}
        />
      )}
    </FlexCol>
  )
}
