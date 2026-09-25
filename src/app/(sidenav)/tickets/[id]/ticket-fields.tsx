'use client'

import { MultiButton } from '@/components/general/button'
import { DatePickerField } from '@/components/general/date-picker'
import { getFieldConstraints } from '@/components/general/field-constraints'
import { Grid } from '@/components/general/grid'
import { InputField } from '@/components/general/input'
import { NoticePanel, Panel } from '@/components/general/panel'
import { SingleSelectField } from '@/components/general/select'
import { TrashIcon } from '@/components/icon'
import { TagIdSelectField } from '@/components/ticket/tag-id-select'
import { AgentStateChip, PriorityChip, StatusChip, TagChips } from '@/components/ticket/ticket-chip'
import {
  AGENT_MODE_NONE,
  useAgentModeOptions,
  useBoardName,
  useTicketOptions,
} from '@/components/ticket/ticket-options'
import { UserSelectField } from '@/components/user-select'
import type { AgentTaskMode, TicketStatus } from '@/generated/prisma/enums'
import { parseAction } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat, utcToDateOnly } from '@/lib/day'
import { PatchTicketIn, scPatchTicket, zTicketTitle } from '@/lib/schema/schema-ticket'
import { useLocale } from '@/locale/client'
import { FC } from 'react'
import { createTicketTag } from '../server'
import { type BoardAssignee, type TicketFormOptions } from '../use-ticket-form'
import { GetTicketReturnType } from './server'

/** 保存中の項目。同時に複数の項目は保存させない */
export type EditField = 'title' | 'status' | 'priority' | 'assigneeId' | 'dueDate' | 'tagIds' | 'agentMode'

/** 保存中の楽観値。status / agentMode は patchTicket の対象外なので別枠で持つ */
export type Draft = Partial<PatchTicketIn> & { status?: TicketStatus; agentMode?: AgentTaskMode | null }

/**
 * 編集できない項目の 1 セル。
 * 入力欄(isSmart)と同じ体裁でラベル + 値を縦に並べ、編集できる項目と縦位置を揃える。
 * ラベルは isSmart 時の Label、値側の min-h-7 は isSmart 時の入力欄の高さ(28px)に合わせている。
 */
const MetaText: FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className='flex flex-col'>
    <span className='text-xs font-light'>{label}</span>
    <div className='flex min-h-7 items-center gap-2 text-sm'>{children}</div>
  </div>
)

type Ticket = NonNullable<GetTicketReturnType>

/**
 * 詳細画面の項目のグリッドと作成 / 更新の注記。
 * 各項目は変更と同時に保存する(保存処理と楽観値は呼び出し側が持つ)。
 */
export const TicketFieldPanel: FC<{
  ticket: Ticket
  /** 保存中の楽観値 */
  draft: Draft
  savingField?: EditField
  /** 入力途中の件名 */
  title: string
  onTitleChange: (title: string) => void
  /** 選択肢。未取得の間はタグを表示専用にする */
  options?: TicketFormOptions
  boardAssignees: BoardAssignee[]
  patch: (field: EditField, input: Partial<PatchTicketIn>) => Promise<void>
  changeStatus: (status: TicketStatus) => Promise<void>
  changeAgentMode: (agentMode: AgentTaskMode | null) => Promise<void>
  onRemove: () => void
}> = ({
  ticket,
  draft,
  savingField,
  title,
  onTitleChange: setTitle,
  options,
  boardAssignees,
  patch,
  changeStatus,
  changeAgentMode,
  onRemove: remove,
}) => {
  const { t, fet } = useLocale()
  const tz = useUserTimezone()
  const { statusOptions, priorityOptions } = useTicketOptions()
  const agentModeOptions = useAgentModeOptions()
  const boardName = useBoardName()

  const canEdit = ticket.canEdit
  // 保存中の楽観値を優先する。null(クリア) と undefined(未変更) は区別する
  const status = draft.status ?? ticket.status
  const priority = draft.priority ?? ticket.priority
  const assigneeId = draft.assigneeId !== undefined ? draft.assigneeId : ticket.assigneeId
  const dueDate = draft.dueDate !== undefined ? draft.dueDate : utcToDateOnly(ticket.dueDate)
  const tagIds = draft.tagIds ?? ticket.tags.map((tag) => tag.id)
  const agentMode = draft.agentMode !== undefined ? draft.agentMode : ticket.agentMode

  const titleParsed = zTicketTitle.safeParse(title)
  const titleError = titleParsed.success ? undefined : fet({ message: titleParsed.error.issues[0]?.message })
  const saveTitle = () => {
    if (!titleParsed.success || titleParsed.data === ticket.title) {
      return
    }
    void patch('title', { title: titleParsed.data })
  }

  // 候補が揃うまでは選択肢が空になり選択済みの値が消えてしまうため、表示専用にフォールバックする
  const canEditAssignee = canEdit && boardAssignees.length > 0
  const canEditTags = canEdit && !!options

  return (
    <Panel>
      <Grid // 項目の並びは作成モーダル(../modals.tsx の AddModal)と揃えている
        isSmart
      >
        <div className='col-span-12'>
          {canEdit ? (
            <InputField
              label={t('title')}
              isRequired
              maxLength={getFieldConstraints(scPatchTicket, 'title').maxLength}
              errorMessage={titleError}
              // 保存中の入力は reload で上書きされてしまうため受け付けない
              isDisabled={savingField === 'title'}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              // 入力ごとに保存しないよう、フォーカスを外したときに変更を確定する
              onBlur={saveTitle}
            />
          ) : (
            <MetaText label={t('title')}>{ticket.title}</MetaText>
          )}
        </div>

        <div className='col-span-12 md:col-span-6'>
          <MetaText // ボードは詳細画面では変更させない
            label={t('board')}
          >
            {boardName({ name: ticket.boardName, kind: ticket.boardKind })}
          </MetaText>
        </div>

        <div className='col-span-12 md:col-span-6'>
          {canEditTags ? (
            <TagIdSelectField
              // そのボードのタグだけを候補にする(他ボードのタグはサーバー側で弾かれる)
              options={options.tags.filter((tag) => tag.boardId === ticket.boardId)}
              onCreate={async (name) => parseAction(createTicketTag({ boardId: ticket.boardId, name }))}
              value={tagIds}
              // 保存中に isDisabled にするとポップオーバーが閉じて連続選択できないため無効化しない
              onChange={(next) => void patch('tagIds', { tagIds: next })}
            />
          ) : (
            <MetaText label={t('tags')}>{ticket.tags.length > 0 ? <TagChips tags={ticket.tags} /> : '-'}</MetaText>
          )}
        </div>

        <div className='col-span-6 md:col-span-2'>
          {canEdit ? (
            <SingleSelectField
              label={t('status')}
              groupOptions={statusOptions}
              value={status}
              isDisabled={savingField === 'status'}
              onChange={(next) => {
                if (next && next !== ticket.status) {
                  void changeStatus(next as TicketStatus)
                }
              }}
            />
          ) : (
            <MetaText label={t('status')}>
              <StatusChip value={status} />
            </MetaText>
          )}
        </div>

        <div className='col-span-6 md:col-span-2'>
          {canEdit ? (
            <SingleSelectField
              label={t('priority')}
              groupOptions={priorityOptions}
              value={priority}
              isDisabled={savingField === 'priority'}
              onChange={(next) => {
                if (next && next !== ticket.priority) {
                  void patch('priority', { priority: next as typeof priority })
                }
              }}
            />
          ) : (
            <MetaText label={t('priority')}>
              <PriorityChip value={priority} />
            </MetaText>
          )}
        </div>

        <div className='col-span-6 md:col-span-4'>
          {canEditAssignee ? (
            <UserSelectField
              isClearable
              options={boardAssignees}
              value={assigneeId}
              isDisabled={savingField === 'assigneeId'}
              onChange={(next) => {
                if (next !== (ticket.assigneeId ?? null)) {
                  void patch('assigneeId', { assigneeId: next })
                }
              }}
            />
          ) : (
            <MetaText label={t('assignee')}>{ticket.assigneeName || t('unassigned')}</MetaText>
          )}
        </div>

        <div className='col-span-6 md:col-span-4'>
          {canEdit ? (
            <DatePickerField
              label={t('due_date')}
              value={dueDate}
              isDisabled={savingField === 'dueDate'}
              onChange={(next) => {
                if (next !== utcToDateOnly(ticket.dueDate)) {
                  void patch('dueDate', { dueDate: next })
                }
              }}
            />
          ) : (
            <MetaText label={t('due_date')}>
              <span className='font-mono text-xs'>{dayformat(ticket.dueDate, 'date') || '-'}</span>
            </MetaText>
          )}
        </div>

        {ticket.assigneeIsAgent && (
          <>
            <div className='col-span-6 md:col-span-3'>
              {ticket.canEditAgentMode ? (
                <SingleSelectField
                  label={t('agent_mode')}
                  groupOptions={agentModeOptions}
                  value={agentMode ?? AGENT_MODE_NONE}
                  isDisabled={savingField === 'agentMode'}
                  onChange={(next) => {
                    const value = next === AGENT_MODE_NONE ? null : (next as typeof agentMode)
                    if (next !== null && value !== (ticket.agentMode ?? null)) {
                      void changeAgentMode(value)
                    }
                  }}
                />
              ) : (
                <MetaText label={t('agent_mode')}>
                  {agentMode ? agentModeOptions[agentMode] : t('agent_mode_none')}
                </MetaText>
              )}
            </div>
            <div className='col-span-6 md:col-span-3'>
              <MetaText label={t('agent_state')}>
                <AgentStateChip value={ticket.agentState ?? 'queued'} />
              </MetaText>
            </div>
            <div className='col-span-12 md:col-span-6'>
              <NoticePanel className='text-xs'>{t('msg_agent_mode_desc')}</NoticePanel>
            </div>
          </>
        )}
      </Grid>

      <div // 作成 / 更新はチケットの属性ではないので、項目のグリッドから外して注記にする
        className='text-muted mt-2 flex flex-wrap items-center gap-x-3 border-t pt-2 text-xs'
      >
        <span>
          {t('created_at')} <span className='font-mono'>{dayformat(ticket.createdAt, 'tz-minute', tz)}</span>
          {ticket.createdByName && <span className='ml-1'>{ticket.createdByName}</span>}
        </span>
        <span>
          {t('updated_at')} <span className='font-mono'>{dayformat(ticket.updatedAt, 'tz-minute', tz)}</span>
        </span>
        {ticket.completedAt && (
          <span>
            {t('completed_at')} <span className='font-mono'>{dayformat(ticket.completedAt, 'tz-minute', tz)}</span>
          </span>
        )}
        {ticket.canDelete && (
          <MultiButton
            isIconOnly
            size='sm'
            variant='danger-soft'
            className='ml-auto'
            tooltip={t('delete')}
            icon={<TrashIcon width={16} />}
            onPress={remove}
          />
        )}
      </div>
    </Panel>
  )
}
