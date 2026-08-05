'use client'

import { GridBox } from '@/components/general/grid'
import { InputSearchField } from '@/components/general/input'
import { SingleSelectField } from '@/components/general/select'
import { MultiTagField } from '@/components/general/tag-group'
import { SelfAssigneeAction } from '@/components/ticket/assignee-select'
import { TagNameSelectField } from '@/components/ticket/tag-select'
import { useTicketOptions } from '@/components/ticket/ticket-chip'
import type { BoardKind, TagColor } from '@/generated/prisma/enums'
import { TicketSearch } from '@/lib/schema'
import {
  dedupeTagOptionsByName,
  MAX_TICKET_TAGS,
  OPEN_TICKET_STATUSES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from '@/lib/task'
import { useLocale } from '@/locale/client'
import { FC, useState } from 'react'

/** 検索条件の初期値(ステータスは完了以外を選択済み) */
export const defaultTicketFilter: TicketSearch = {
  keyword: '',
  status: OPEN_TICKET_STATUSES,
  priority: [],
  tags: [],
  boardId: null,
  assignee: 'any',
}

/** 対象の Select で「すべてのボード」を表す値(boardId = null に対応) */
const BOARD_ALL = 'all'

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

  const applyKeyword = (value: string) => onChange({ ...filter, keyword: value.trim() })

  return (
    <GridBox isSmart>
      <div className='col-span-12 md:col-span-5'>
        <InputSearchField
          label={t('keyword')}
          placeholder={t('keyword')}
          maxLength={100}
          searchLabel={t('search')}
          value={keyword}
          onChange={setKeyword}
          onSubmit={applyKeyword}
          onClear={() => onChange({ ...filter, keyword: '' })}
        />
      </div>

      <div className='col-span-6 md:col-span-4'>
        <SingleSelectField
          label={t('target_board')}
          groupOptions={boardOptions}
          value={filter.boardId ?? BOARD_ALL}
          /** ボードを変えるとタグの候補(tagChoices)も変わるので、選択済みのタグ名は捨てる */
          onChange={(value) => onChange({ ...filter, boardId: !value || value === BOARD_ALL ? null : value, tags: [] })}
        />
      </div>

      <div className='col-span-6 md:col-span-3'>
        <SingleSelectField
          label={t('assignee')}
          groupOptions={assigneeOptions}
          value={filter.assignee}
          onChange={(value) => onChange({ ...filter, assignee: (value ?? 'any') as TicketSearch['assignee'] })}
          labelAction={
            // 候補が userId ではなく 'me' なので、担当者の候補に依らず常に選べる
            <SelfAssigneeAction onPress={() => onChange({ ...filter, assignee: 'me' })} />
          }
        />
      </div>

      <div className='col-span-6 md:col-span-4'>
        <MultiTagField
          label={t('status')}
          items={TICKET_STATUSES.map((status) => ({ id: status, label: statusOptions[status] }))}
          value={filter.status}
          onChange={(status) => onChange({ ...filter, status })}
        />
      </div>

      <div className='col-span-6 md:col-span-3'>
        <MultiTagField
          label={t('priority')}
          items={TICKET_PRIORITIES.map((priority) => ({ id: priority, label: priorityOptions[priority] }))}
          value={filter.priority}
          onChange={(priority) => onChange({ ...filter, priority })}
        />
      </div>

      {tagChoices.length > 0 && (
        <div className='col-span-12 md:col-span-5'>
          <TagNameSelectField // 絞り込みの値は tagId ではなく名前(ボード横断でも同名を 1 条件にまとめる)
            options={tagChoices}
            value={filter.tags}
            max={MAX_TICKET_TAGS}
            onChange={(tags) => onChange({ ...filter, tags })}
          />
        </div>
      )}
    </GridBox>
  )
}
