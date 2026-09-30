'use client'

import { DatePickerCtrl } from '@/components/general/date-picker'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { SingleSelectCtrl, SingleSelectField } from '@/components/general/select'
import { PlusIcon } from '@/components/icon'
import { MarkdownCtrl } from '@/components/markdown/markdown-editor'
import { notify } from '@/components/notify'
import {
  CriteriaRowsField,
  type CriterionDraftRow,
  filledCriterionRows,
  isValidCriterionRows,
  toCriterionDraftRows,
} from '@/components/ticket/criteria-rows-field'
import { TagSelectCtrl } from '@/components/ticket/tag-id-select'
import { useBoardName, useTicketOptions } from '@/components/ticket/ticket-options'
import { UserSelectCtrl } from '@/components/user-select'
import type { TicketStatus } from '@/generated/prisma/enums'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { CreateTicketIn, CreateTicketOut, scCreateTicket } from '@/lib/schema/schema-ticket'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC, useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { createTicket, createTicketTag, getTicketTemplateOptions } from './server'
import { type TicketFormOptions, useBoardAssignees } from './use-ticket-form'

/**
 * チケット作成モーダル。
 * ボードは必須(既定はプライベートボード)で、担当者とタグの候補は選択中のボードに連動する。
 *
 * かんばん(/boards/[id])のレーンからも開くため、初期ステータスとボード固定を受け取れるようにしている。
 */
export const AddModal: FC<
  ModalBaseProps & {
    options: TicketFormOptions
    defaultBoardId?: string | null
    /** レーン別の追加ボタンから開いた場合の初期ステータス */
    defaultStatus?: TicketStatus
    /** true ならボードを変更させない(かんばんで作ったカードが画面に出ない事故を防ぐ) */
    isBoardLocked?: boolean
  }
> = ({ state, reload, options, defaultBoardId, defaultStatus, isBoardLocked }) => {
  const { t, fet } = useLocale()
  const { statusOptions, priorityOptions } = useTicketOptions()
  const boardName = useBoardName()
  const boardOptions = Object.fromEntries(options.boards.map((board) => [board.id, boardName(board)]))

  const initialBoardId = defaultBoardId ?? options.privateBoardId
  /** そのボードでの既定担当者。プライベートボードはメンバーが本人 1 人なので本人を選んでおく */
  const defaultAssigneeId = (boardId: string) => (boardId === options.privateBoardId ? options.selfUserId : null)

  const {
    control,
    handleSubmit,
    setValue,
    formState: { isSubmitting, errors },
  } = useForm<CreateTicketIn, unknown, CreateTicketOut>({
    resolver: zodResolver(scCreateTicket),
    mode: 'onChange',
    defaultValues: {
      boardId: initialBoardId,
      title: '',
      content: '',
      status: defaultStatus ?? 'todo',
      priority: 'medium',
      dueDate: null,
      tagIds: [],
      assigneeId: defaultAssigneeId(initialBoardId),
    },
  })

  const boardId = useWatch({ control, name: 'boardId' })
  const { assignees: boardAssignees } = useBoardAssignees(boardId)
  // タグは選択中のボードのものだけを候補にする(他ボードのタグはサーバー側で弾かれる)
  const boardTags = options.tags.filter((tag) => tag.boardId === boardId)
  const { data: templates } = useActionData(() => getTicketTemplateOptions({ id: boardId }), {
    skip: !boardId,
    key: boardId,
  })
  const boardTemplates = templates ?? []
  const templateOptions = Object.fromEntries(boardTemplates.map((template) => [template.id, template.name]))
  // 選んだボードも覚えておき、ボードを切り替えたら選択を外れた扱いにする
  const [selected, setSelected] = useState<{ boardId: string; id: string | null }>()
  const templateId = selected?.boardId === boardId ? selected.id : null
  // 受け入れ条件は行の並べ替えがあるため react-hook-form の外で持ち、送信時に文言だけを渡す
  const [criteria, setCriteria] = useState<CriterionDraftRow[]>([])
  // 本文のエディタは初回の値しか取り込まないので、テンプレートを写したときは作り直す
  const [contentKey, setContentKey] = useState(0)

  // ボードが変わったら前のボードの担当者・タグの ID が残らないよう既定値へ戻す
  // (初回マウントでも走るが defaultValues と同じ値を書くだけなので実害はない)
  useEffect(() => {
    setValue('assigneeId', boardId === options.privateBoardId ? options.selfUserId : null)
    setValue('tagIds', [])
  }, [boardId, options.privateBoardId, options.selfUserId, setValue])

  /**
   * テンプレートの内容をフォームへ写す。テンプレートが持つ項目だけを置き換え、空の項目は入力済みの値を残す。
   * 写した後は通常の入力と同じく自由に編集できる
   */
  const applyTemplate = (id: string | null) => {
    setSelected({ boardId, id })
    const template = boardTemplates.find((row) => row.id === id)
    if (!template) {
      return
    }
    if (template.content) {
      setValue('content', template.content)
      setContentKey((key) => key + 1)
    }
    if (template.priority) {
      setValue('priority', template.priority)
    }
    if (template.tagIds.length > 0) {
      setValue('tagIds', template.tagIds, { shouldValidate: true })
    }
    if (template.criteria.length > 0) {
      setCriteria(toCriterionDraftRows(template.criteria))
    }
  }

  return (
    <FormModal
      state={state}
      size='5xl'
      onSubmit={handleSubmit(async (req) => {
        const res = await parseAction(
          createTicket({ ...req, criteria: filledCriterionRows(criteria).map((row) => row.text) }),
        )
        notify.success(t('msg_added_target', { target: res.title }))
        reload()
        state.close()
      })}
      title={{ text: t('add_ticket'), icon: <PlusIcon /> }}
      submit={{ isPending: isSubmitting, isDisabled: !isValidCriterionRows(criteria) }}
    >
      <GridBox isSmart>
        {boardTemplates.length > 0 && (
          <div className='col-span-12 md:col-span-4'>
            <SingleSelectField
              groupOptions={templateOptions}
              label={t('ticket_template')}
              value={templateId}
              onChange={applyTemplate}
              isClearable
            />
          </div>
        )}
        <div className='col-span-12 md:col-span-8'>
          <InputCtrl
            control={control}
            name='title'
            constraintSchema={scCreateTicket}
            label={t('title')}
            errorMessage={fet(errors.title)}
            autoFocus
          />
        </div>

        <div className='col-span-6 md:col-span-4'>
          <SingleSelectCtrl
            control={control}
            name='boardId'
            groupOptions={boardOptions}
            label={t('board')}
            isDisabled={isBoardLocked}
          />
        </div>
        <div className='col-span-6 md:col-span-2'>
          <SingleSelectCtrl control={control} name='status' groupOptions={statusOptions} label={t('status')} />
        </div>
        <div className='col-span-6 md:col-span-1'>
          <SingleSelectCtrl control={control} name='priority' groupOptions={priorityOptions} label={t('priority')} />
        </div>
        <div className='col-span-6 md:col-span-2'>
          <UserSelectCtrl control={control} name='assigneeId' options={boardAssignees} isClearable />
        </div>
        <div className='col-span-6 md:col-span-3'>
          <DatePickerCtrl control={control} name='dueDate' label={t('due_date')} errorMessage={fet(errors.dueDate)} />
        </div>

        <div className='col-span-12 md:col-span-4'>
          <TagSelectCtrl
            control={control}
            name='tagIds'
            options={boardTags}
            errorMessage={fet(errors.tagIds)}
            onCreate={async (name) => parseAction(createTicketTag({ boardId, name }))}
          />
        </div>

        <div className='col-span-12'>
          <MarkdownCtrl
            key={contentKey}
            control={control}
            name='content'
            constraintSchema={scCreateTicket}
            errorMessage={fet(errors.content)}
            uploadBoardId={boardId}
            // メンション候補は担当者候補と同じボードメンバー(取得を 1 本にまとめている)
            mentionCandidates={boardAssignees}
          />
        </div>

        <div className='col-span-12 space-y-1'>
          <div className='text-sm'>{t('acceptance_criteria')}</div>
          <CriteriaRowsField rows={criteria} onChange={setCriteria} />
        </div>
      </GridBox>
    </FormModal>
  )
}
