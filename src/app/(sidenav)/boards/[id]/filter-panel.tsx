'use client'

import { GridBox } from '@/components/general/grid'
import { SingleSelectField } from '@/components/general/select'
import { MultiTagField } from '@/components/general/tag-group'
import { TagNameSelectField, TagSelectOption } from '@/components/ticket/tag-select'
import { useTicketOptions } from '@/components/ticket/ticket-chip'
import { KANBAN_ASSIGNEE_NONE, KanbanFilter, MAX_TICKET_TAGS, TICKET_PRIORITIES } from '@/lib/task'
import { useLocale } from '@/locale/client'
import { FC } from 'react'

/** 担当者の Select で「すべて」を表す値(assignee = null に対応) */
const ASSIGNEE_ALL = 'all'

/**
 * かんばんの絞り込みパネル。
 *
 * チケット一覧の `TicketSearchPanel` と同じ部品で組むが、対象が単一ボードなので
 * キーワード / ボード / ステータス(= レーン)は持たず、担当者はそのボードのメンバーから選ばせる。
 * 絞り込み自体はサーバーへ投げずクライアントで行う(呼び出し側の `filterLaneMap` を参照)。
 */
export const KanbanFilterPanel: FC<{
  filter: KanbanFilter
  onChange: (filter: KanbanFilter) => void
  /** ボードメンバーの userId -> 表示名 */
  assigneeOptions: Record<string, string>
  /** そのボードのタグ(呼び出し側で絞り込み済み) */
  tags: TagSelectOption[]
}> = ({ filter, onChange, assigneeOptions, tags }) => {
  const { t } = useLocale()
  const { priorityOptions } = useTicketOptions()

  const assigneeChoices: Record<string, string> = {
    [ASSIGNEE_ALL]: t('all'),
    [KANBAN_ASSIGNEE_NONE]: t('unassigned'),
    ...assigneeOptions,
  }

  return (
    <GridBox isSmart>
      <div className='col-span-12 md:col-span-4'>
        <SingleSelectField
          label={t('assignee')}
          groupOptions={assigneeChoices}
          value={filter.assignee ?? ASSIGNEE_ALL}
          onChange={(value) => onChange({ ...filter, assignee: !value || value === ASSIGNEE_ALL ? null : value })}
        />
      </div>

      <div className='col-span-12 md:col-span-4'>
        <MultiTagField
          label={t('priority')}
          items={TICKET_PRIORITIES.map((priority) => ({ id: priority, label: priorityOptions[priority] }))}
          value={filter.priority}
          onChange={(priority) => onChange({ ...filter, priority })}
        />
      </div>

      {tags.length > 0 && (
        <div className='col-span-12 md:col-span-4'>
          <TagNameSelectField // 絞り込みの値は tagId ではなく名前(チケット一覧の絞り込みと揃える)
            options={tags}
            value={filter.tags}
            max={MAX_TICKET_TAGS}
            onChange={(next) => onChange({ ...filter, tags: next })}
          />
        </div>
      )}
    </GridBox>
  )
}
