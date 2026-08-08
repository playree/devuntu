'use client'

import { DateRangePickerField } from '@/components/general/date-picker'
import { GridBox } from '@/components/general/grid'
import { MultiTagField } from '@/components/general/tag-group'
import { AssigneeOption, AssigneeSelectField } from '@/components/ticket/assignee-select'
import { TagNameSelectField, TagSelectOption } from '@/components/ticket/tag-select'
import { useTicketOptions } from '@/components/ticket/ticket-chip'
import { ASSIGNEE_NONE, KanbanFilter, MAX_TICKET_TAGS, TICKET_PRIORITIES } from '@/lib/task'
import { useLocale } from '@/locale/client'
import { FC } from 'react'

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
  /** ボードメンバー */
  assigneeOptions: AssigneeOption[]
  /** そのボードのタグ(呼び出し側で絞り込み済み) */
  tags: TagSelectOption[]
}> = ({ filter, onChange, assigneeOptions, tags }) => {
  const { t } = useLocale()
  const { priorityOptions } = useTicketOptions()

  // 先頭はユーザーではないセンチネルなのでアバターを出さない。「すべて」は選択肢ではなく未選択で表す
  const assigneeChoices: AssigneeOption[] = [
    { id: ASSIGNEE_NONE, name: t('unassigned'), hideAvatar: true },
    ...assigneeOptions,
  ]

  return (
    <GridBox isSmart>
      <div className='col-span-6 md:col-span-2'>
        <AssigneeSelectField
          options={assigneeChoices}
          value={filter.assignee}
          isClearable // 選択後に「すべて」(未選択)へ戻す手段
          placeholder={t('all')}
          onChange={(assignee) => onChange({ ...filter, assignee })}
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

      <div className='col-span-12 md:col-span-3'>
        <DateRangePickerField // 期日は範囲(両端含む)。開始・終了が揃った時点で絞り込みが効き、クリアで解除する
          label={t('due_date')}
          value={filter.due}
          onChange={(due) => onChange({ ...filter, due })}
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
