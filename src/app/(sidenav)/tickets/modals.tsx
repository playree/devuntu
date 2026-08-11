'use client'

import { MultiButton } from '@/components/general/button'
import { DatePickerCtrl } from '@/components/general/date-picker'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { SingleSelectCtrl } from '@/components/general/select'
import { CheckIcon, PlusIcon } from '@/components/icon'
import { MarkdownEditor } from '@/components/markdown/markdown-editor'
import { notify } from '@/components/notify'
import { AssigneeOption, AssigneeSelectCtrl } from '@/components/ticket/assignee-select'
import { TagSelect } from '@/components/ticket/tag-select'
import { useBoardName, useTicketOptions } from '@/components/ticket/ticket-chip'
import type { TicketStatus } from '@/generated/prisma/enums'
import { parseAction } from '@/lib/action-client'
import { CreateTicketIn, CreateTicketOut, scCreateTicket } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC, useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { createTicket, createTicketTag, getAssigneeOptions, GetTicketFormOptionsReturnType } from './server'

type FormOptions = NonNullable<GetTicketFormOptionsReturnType>

/**
 * チケット作成モーダル。
 * ボードは必須(既定はプライベートボード)で、担当者とタグの候補は選択中のボードに連動する。
 *
 * かんばん(/boards/[id])のレーンからも開くため、初期ステータスとボード固定を受け取れるようにしている。
 */
export const AddModal: FC<
  ModalBaseProps & {
    options: FormOptions
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
  const [boardAssignees, setBoardAssignees] = useState<AssigneeOption[]>([])
  // タグは選択中のボードのものだけを候補にする(他ボードのタグはサーバー側で弾かれる)
  const boardTags = options.tags.filter((tag) => tag.boardId === boardId)

  useEffect(() => {
    // ボードを続けて切り替えると古い要求が後着しうるので、対象が変わった結果は捨てる
    let isCurrent = true
    parseAction(getAssigneeOptions({ id: boardId }))
      .then((res) => isCurrent && setBoardAssignees(res ?? []))
      .catch(() => isCurrent && setBoardAssignees([]))
    return () => {
      isCurrent = false
    }
  }, [boardId])

  // ボードが変わったら前のボードの担当者・タグの ID が残らないよう既定値へ戻す
  // (初回マウントでも走るが defaultValues と同じ値を書くだけなので実害はない)
  useEffect(() => {
    setValue('assigneeId', boardId === options.privateBoardId ? options.selfUserId : null)
    setValue('tagIds', [])
  }, [boardId, options.privateBoardId, options.selfUserId, setValue])

  return (
    <FormModal
      state={state}
      size='5xl'
      onSubmit={handleSubmit(async (req) => {
        const res = await parseAction(createTicket(req))
        notify.success(t('msg_added_target', { target: res.title }))
        reload()
        state.close()
      })}
      title={{ text: t('add_ticket'), icon: <PlusIcon /> }}
      footer={
        <>
          <MultiButton slot='close' variant='ghost'>
            {t('cancel')}
          </MultiButton>
          <MultiButton type='submit' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('ok')}
          </MultiButton>
        </>
      }
    >
      <GridBox isSmart>
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
          <AssigneeSelectCtrl control={control} name='assigneeId' options={boardAssignees} isClearable />
        </div>
        <div className='col-span-6 md:col-span-3'>
          <DatePickerCtrl control={control} name='dueDate' label={t('due_date')} errorMessage={fet(errors.dueDate)} />
        </div>

        <div className='col-span-12 md:col-span-4'>
          <TagSelect
            control={control}
            name='tagIds'
            options={boardTags}
            errorMessage={fet(errors.tagIds)}
            onCreate={async (name) => parseAction(createTicketTag({ boardId, name }))}
          />
        </div>

        <div className='col-span-12'>
          <MarkdownEditor
            control={control}
            name='content'
            constraintSchema={scCreateTicket}
            errorMessage={fet(errors.content)}
            uploadBoardId={boardId}
          />
        </div>
      </GridBox>
    </FormModal>
  )
}
