'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { usePagingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ChatBubbleIcon,
  FunnelIcon,
  PlusIcon,
  TicketIcon,
} from '@/components/icon'
import { notify } from '@/components/notify'
import { PriorityChip, StatusChip, TagChips, useBoardName } from '@/components/ticket/ticket-chip'
import { parseAction } from '@/lib/action-client'
import { dayformat } from '@/lib/day'
import { TicketSearch } from '@/lib/schema'
import { MAX_TICKET_LIST } from '@/lib/task'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { Accordion, ButtonGroup, Table } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useRef, useState } from 'react'
import { AddModal } from './modals'
import { defaultTicketFilter, TicketSearchPanel } from './search-panel'
import { deleteTicket, getTicketFormOptions, GetTicketFormOptionsReturnType, getTickets } from './server'

const defaultExpandedKeys = new Set(['search'])

export const TicketsClient: FC = () => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const router = useRouter()
  const boardName = useBoardName()
  const addModalState = useModalState()

  const [filter, setFilter] = useState<TicketSearch>(defaultTicketFilter)
  // usePagingList の load は再生成されるため、最新の検索条件は ref から読む
  const filterRef = useRef(filter)
  const [options, setOptions] = useState<GetTicketFormOptionsReturnType>()

  const list = usePagingList({
    load: async () => {
      const res = await parseAction(getTickets(filterRef.current))
      return res ?? []
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

  const applyFilter = (next: TicketSearch) => {
    filterRef.current = next
    setFilter(next)
    list.reload()
  }

  const reloadAll = () => {
    list.reload()
    loadOptions()
  }

  return (
    <FlexCol data-wide className='mx-auto max-w-6xl'>
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
        <Accordion.Item id='search'>
          <Accordion.Heading>
            <Accordion.Trigger className='gap-1'>
              <FunnelIcon />
              {t('filter')}
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body>
              <TicketSearchPanel
                filter={filter}
                onChange={applyFilter}
                boards={(options?.boards ?? []).map((board) => ({ ...board, name: boardName(board) }))}
                tags={options?.tags ?? []}
              />
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      {list.total >= MAX_TICKET_LIST && (
        <div className='px-1 text-xs text-gray-500'>{t('msg_ticket_list_limit', { max: `${MAX_TICKET_LIST}` })}</div>
      )}

      <MultiTable
        ariaLabel='ticket list'
        pagingList={list}
        columns={[
          { id: 'title', name: t('title'), isRowHeader: true, allowsSorting: true, minWidth: 140, defaultWidth: '2fr' },
          { id: 'status', name: t('status'), allowsSorting: true, minWidth: 100, defaultWidth: 100 },
          { id: 'priority', name: t('priority'), allowsSorting: true, minWidth: 70, defaultWidth: 70 },
          { id: 'assigneeName', name: t('assignee'), allowsSorting: true, minWidth: 100, defaultWidth: 100 },
          { id: 'dueDate', name: t('due_date'), allowsSorting: true, minWidth: 110, defaultWidth: 110 },
          { id: 'tags', name: t('tags'), allowsSorting: false, minWidth: 100 },
          { id: 'updatedAt', name: t('updated_at'), allowsSorting: true, minWidth: 110, defaultWidth: 110 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 100 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell>
              <div className='flex flex-col gap-0.5'>
                <span className='truncate'>{item.title}</span>
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
            <ActionCell
              items={[
                {
                  template: 'none',
                  key: 'open',
                  icon: <ArrowTopRightOnSquareIcon />,
                  tooltip: t('list'),
                  onPress: () => router.push(`/tickets/${item.id}`),
                },
                {
                  template: 'delete',
                  target: item.title,
                  action: async () => {
                    await parseAction(deleteTicket({ id: item.id }))
                    notify.success(t('msg_deleted_target', { target: item.title }))
                    reloadAll()
                  },
                },
              ]}
            />
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
    </FlexCol>
  )
}
