'use client'

import { MultiButton } from '@/components/general/button'
import { GridBox } from '@/components/general/grid'
import { MagnifyingGlassIcon } from '@/components/icon'
import { TagChip, useTicketOptions } from '@/components/ticket/ticket-chip'
import type { BoardKind, TagColor, TicketPriority, TicketStatus } from '@/generated/prisma/enums'
import { TicketSearch } from '@/lib/schema'
import { dedupeTagOptionsByName, TICKET_PRIORITIES, TICKET_STATUSES } from '@/lib/task'
import { useLocale } from '@/locale/client'
import { Chip, Input, Label, ListBox, Select } from '@heroui/react'
import { FC, KeyboardEvent, useState } from 'react'

/** 検索条件の初期値 */
export const emptyTicketFilter: TicketSearch = {
  keyword: '',
  status: [],
  priority: [],
  tags: [],
  boardId: null,
  assignee: 'any',
}

/** 対象の Select で「すべてのボード」を表す値(boardId = null に対応) */
const BOARD_ALL = 'all'

const toggle = <T,>(values: T[], value: T): T[] =>
  values.includes(value) ? values.filter((v) => v !== value) : [...values, value]

/** クリックで ON/OFF する絞り込み用の Chip */
const FilterChip: FC<{ label: string; isActive: boolean; onToggle: () => void }> = ({ label, isActive, onToggle }) => (
  <Chip
    variant={isActive ? 'soft' : 'tertiary'}
    color={isActive ? 'accent' : undefined}
    size='sm'
    role='button'
    className='cursor-pointer'
    onClick={onToggle}
  >
    <Chip.Label>{label}</Chip.Label>
  </Chip>
)

/**
 * チケット一覧の検索・フィルタパネル。
 * キーワードは Enter / 検索ボタンで確定し、その他の条件は変更即時で反映する。
 */
export const TicketSearchPanel: FC<{
  filter: TicketSearch
  onChange: (filter: TicketSearch) => void
  /** 表示名は呼び出し側で解決済み(プライベートはロケール名) */
  boards: { id: string; name: string; kind: BoardKind }[]
  tags: { id: string; boardId: string; name: string; color: TagColor }[]
}> = ({ filter, onChange, boards, tags }) => {
  const { t } = useLocale()
  const { statusOptions, priorityOptions } = useTicketOptions()
  const [keyword, setKeyword] = useState(filter.keyword)

  const boardOptions: Record<string, string> = {
    [BOARD_ALL]: t('all'),
    ...Object.fromEntries(boards.map((board) => [board.id, board.name])),
  }

  // 絞り込み対象のボードのタグだけを出し、同名(別ボード)は 1 チップに畳む
  const tagChoices = dedupeTagOptionsByName(
    filter.boardId ? tags.filter((tag) => tag.boardId === filter.boardId) : tags,
  )

  const assigneeOptions: Record<string, string> = {
    any: t('all'),
    me: t('assigned_to_me'),
    none: t('unassigned'),
  }

  const applyKeyword = () => onChange({ ...filter, keyword: keyword.trim() })

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      applyKeyword()
    }
  }

  return (
    <GridBox>
      <div className='col-span-12 md:col-span-6'>
        <Label>{t('keyword')}</Label>
        <div className='flex items-center gap-2'>
          <Input
            value={keyword}
            variant='secondary'
            maxLength={100}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <MultiButton isIconOnly size='sm' tooltip={t('keyword')} onPress={applyKeyword}>
            <MagnifyingGlassIcon />
          </MultiButton>
        </div>
      </div>

      <div className='col-span-12 md:col-span-3'>
        <Select
          selectionMode='single'
          variant='secondary'
          value={filter.boardId ?? BOARD_ALL}
          onChange={(key) => {
            const value = key?.toString() ?? BOARD_ALL
            onChange({ ...filter, boardId: value === BOARD_ALL ? null : value })
          }}
        >
          <Label>{t('ticket_scope')}</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox selectionMode='single'>
              {Object.entries(boardOptions).map(([id, name]) => (
                <ListBox.Item key={id} id={id} textValue={name}>
                  {name}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      <div className='col-span-12 md:col-span-3'>
        <Select
          selectionMode='single'
          variant='secondary'
          value={filter.assignee}
          onChange={(key) => onChange({ ...filter, assignee: (key?.toString() ?? 'any') as TicketSearch['assignee'] })}
        >
          <Label>{t('assignee')}</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox selectionMode='single'>
              {Object.entries(assigneeOptions).map(([id, name]) => (
                <ListBox.Item key={id} id={id} textValue={name}>
                  {name}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      <div className='col-span-12 md:col-span-6'>
        <Label>{t('status')}</Label>
        <div className='flex flex-wrap gap-1 pt-1'>
          {TICKET_STATUSES.map((status) => (
            <FilterChip
              key={status}
              label={statusOptions[status]}
              isActive={filter.status.includes(status)}
              onToggle={() => onChange({ ...filter, status: toggle<TicketStatus>(filter.status, status) })}
            />
          ))}
        </div>
      </div>

      <div className='col-span-12 md:col-span-6'>
        <Label>{t('priority')}</Label>
        <div className='flex flex-wrap gap-1 pt-1'>
          {TICKET_PRIORITIES.map((priority) => (
            <FilterChip
              key={priority}
              label={priorityOptions[priority]}
              isActive={filter.priority.includes(priority)}
              onToggle={() => onChange({ ...filter, priority: toggle<TicketPriority>(filter.priority, priority) })}
            />
          ))}
        </div>
      </div>

      {tagChoices.length > 0 && (
        <div className='col-span-12'>
          <Label>{t('tags')}</Label>
          <div className='flex flex-wrap gap-1 pt-1'>
            {tagChoices.map((tag) => (
              <TagChip
                key={tag.id}
                tag={tag}
                // トグルの値は tagId ではなく名前(ボード横断でも同名を 1 条件にまとめる)
                className={filter.tags.includes(tag.name) ? 'cursor-pointer' : 'cursor-pointer opacity-50'}
                onClick={() => onChange({ ...filter, tags: toggle(filter.tags, tag.name) })}
              />
            ))}
          </div>
        </div>
      )}
    </GridBox>
  )
}
