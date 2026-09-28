'use client'

import { GridBox } from '@/components/general/grid'
import { InputSearchField } from '@/components/general/input'
import { SingleSelectField } from '@/components/general/select'
import { MultiTagField } from '@/components/general/tag-group'
import { TagNameSelectField } from '@/components/ticket/tag-name-select'
import { useTicketOptions } from '@/components/ticket/ticket-options'
import { TicketSelectField, useTicketCandidates } from '@/components/ticket/ticket-select'
import { UserSelectField, UserSelectOption } from '@/components/user-select'
import type { BoardKind, TagColor } from '@/generated/prisma/enums'
import { parseAction } from '@/lib/action/action-client'
import type { AssigneeCandidate } from '@/lib/board/board-member'
import { dedupeTagOptionsByName, MAX_TICKET_TAGS } from '@/lib/board/tag-rule'
import { OPEN_TICKET_STATUSES, TICKET_PRIORITIES, TICKET_STATUSES } from '@/lib/board/ticket-enum'
import { TICKET_RELATION_FILTER_LOCALE, TICKET_RELATION_FILTERS } from '@/lib/board/ticket-relation-rule'
import { ASSIGNEE_NONE } from '@/lib/board/ticket-search'
import { TicketSearch, zRelatedTo } from '@/lib/schema/schema-ticket'
import { useLocale } from '@/locale/client'
import { FC, useCallback, useState } from 'react'
import { searchTicketCandidates } from './server'

/** 検索条件の初期値(ステータスは完了以外を選択済み) */
export const defaultTicketFilter: TicketSearch = {
  keyword: '',
  status: OPEN_TICKET_STATUSES,
  priority: [],
  tags: [],
  boardId: null,
  assignee: null,
  relatedTo: '',
  relation: 'all',
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
  /** 可視ボードのメンバー(ボード横断。所属ボードで絞り込む) */
  assignees: AssigneeCandidate[]
}> = ({ filter, onChange, boards, tags, assignees }) => {
  const { t } = useLocale()
  const { statusOptions, priorityOptions } = useTicketOptions()
  const [keyword, setKeyword] = useState(filter.keyword)
  const [relatedTo, setRelatedTo] = useState(filter.relatedTo)
  const [isRelatedToInvalid, setRelatedToInvalid] = useState(false)

  const relationOptions = Object.fromEntries(
    TICKET_RELATION_FILTERS.map((relation) => [relation, t(TICKET_RELATION_FILTER_LOCALE[relation])]),
  )

  const boardOptions: Record<string, string> = {
    [BOARD_ALL]: t('all'),
    ...Object.fromEntries(boards.map((board) => [board.id, board.name])),
  }

  // 絞り込み対象のボードのタグだけを候補にする(ボード未選択時はボード横断で選べてしまうので候補なし)。
  // 同名(別ボード)は 1 チップに畳む
  const tagChoices = filter.boardId ? dedupeTagOptionsByName(tags.filter((tag) => tag.boardId === filter.boardId)) : []

  const boardId = filter.boardId ?? null

  // 関係するチケットの候補も絞り込み対象のボードに合わせる
  const fetchCandidates = useCallback(
    (keyword: string) => parseAction(searchTicketCandidates({ keyword, boardId }), { handled: 'all' }),
    [boardId],
  )
  const { candidates, isSearching, activate } = useTicketCandidates(fetchCandidates, relatedTo)

  // 絞り込み対象のボードのメンバーだけを候補にする(タグと同じ方針)。「すべて」は選択肢ではなく未選択で表す
  const assigneeChoices: UserSelectOption[] = [
    { id: ASSIGNEE_NONE, name: t('unassigned'), hideAvatar: true },
    ...(boardId ? assignees.filter((user) => user.boardIds.includes(boardId)) : assignees),
  ]

  /** ボードを変えた後も選べる担当者か。センチネル(未割り当て)と未選択は常に有効 */
  const canKeepAssignee = (nextBoardId: string | null) =>
    !filter.assignee ||
    filter.assignee === ASSIGNEE_NONE ||
    !nextBoardId ||
    assignees.some((user) => user.id === filter.assignee && user.boardIds.includes(nextBoardId))

  const applyKeyword = (value: string) => onChange({ ...filter, keyword: value.trim() })

  /** 表示IDとして読めない値は検索に投げず、入力欄にエラーを出す */
  const applyRelatedTo = (value: string) => {
    const parsed = zRelatedTo.safeParse(value)
    if (!parsed.success) {
      setRelatedToInvalid(true)
      return
    }
    onChange({ ...filter, relatedTo: parsed.data.toUpperCase() })
  }

  return (
    <GridBox isSmart>
      <div className='col-span-12 md:col-span-5'>
        <InputSearchField
          label={t('keyword')}
          placeholder={t('keyword')}
          maxLength={100}
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
          value={boardId ?? BOARD_ALL}
          /**
           * ボードを変えるとタグの候補(tagChoices)も変わるので、選択済みのタグ名は捨てる。
           * 担当者は同じ人が複数ボードに居るのが普通なので、新しいボードに在籍していれば残す
           */
          onChange={(value) => {
            const nextBoardId = !value || value === BOARD_ALL ? null : value
            onChange({
              ...filter,
              boardId: nextBoardId,
              tags: [],
              assignee: canKeepAssignee(nextBoardId) ? filter.assignee : null,
            })
          }}
        />
      </div>

      <div className='col-span-6 md:col-span-3'>
        <UserSelectField
          options={assigneeChoices}
          showEmail // 表示名が同じユーザーを見分けられるようにする(メールでも絞り込める)
          value={filter.assignee ?? null}
          isClearable // 選択後に「すべて」(未選択)へ戻す手段
          placeholder={t('all')}
          onChange={(assignee) => onChange({ ...filter, assignee })}
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

      <div className='col-span-12 md:col-span-5'>
        <TagNameSelectField // 絞り込みの値は tagId ではなく名前(ボード横断でも同名を 1 条件にまとめる)
          options={tagChoices}
          value={filter.tags}
          max={MAX_TICKET_TAGS}
          isDisabled={!boardId}
          tooltip={boardId ? undefined : t('select_target_board_first')}
          onChange={(tags) => onChange({ ...filter, tags })}
        />
      </div>

      <div className='col-span-7 md:col-span-4'>
        <TicketSelectField
          label={t('related_to_ticket')}
          aria-label={t('related_to_ticket')}
          placeholder={t('search_ticket')}
          options={candidates}
          isLoading={isSearching}
          inputValue={relatedTo}
          onInputChange={(value) => {
            setRelatedTo(value)
            setRelatedToInvalid(false)
            // 入力を消したら絞り込みも解除する
            if (!value.trim() && filter.relatedTo) {
              onChange({ ...filter, relatedTo: '' })
            }
          }}
          onSelect={(option) => {
            setRelatedTo(option.displayId)
            setRelatedToInvalid(false)
            onChange({ ...filter, relatedTo: option.displayId })
          }}
          onSubmit={() => applyRelatedTo(relatedTo)}
          onClear={() => {
            setRelatedTo('')
            setRelatedToInvalid(false)
            onChange({ ...filter, relatedTo: '' })
          }}
          onFocus={activate}
          errorMessage={isRelatedToInvalid ? t('@invalid_display_id') : undefined}
        />
      </div>

      <div className='col-span-5 md:col-span-2'>
        <SingleSelectField
          label={t('relation_filter')}
          groupOptions={relationOptions}
          value={filter.relation}
          onChange={(value) => {
            const relation = TICKET_RELATION_FILTERS.find((item) => item === value) ?? defaultTicketFilter.relation
            onChange({ ...filter, relation })
          }}
        />
      </div>
    </GridBox>
  )
}
