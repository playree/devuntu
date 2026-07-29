'use client'

import { MultiButton } from '@/components/general/button'
import { DatePickerCtrl } from '@/components/general/date-picker-ctrl'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input-ctrl'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { SingleSelectCtrl } from '@/components/general/select-ctrl'
import { CheckIcon, PlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { MarkdownEditor } from '@/components/ticket/markdown-editor'
import { TagSelect } from '@/components/ticket/tag-select'
import { useBoardName, useTicketOptions } from '@/components/ticket/ticket-chip'
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
 */
export const AddModal: FC<ModalBaseProps & { options: FormOptions; defaultBoardId?: string | null }> = ({
  state,
  reload,
  options,
  defaultBoardId,
}) => {
  const { t, fet } = useLocale()
  const { statusOptions, priorityOptions } = useTicketOptions()
  const boardName = useBoardName()
  const boardOptions = Object.fromEntries(options.boards.map((board) => [board.id, boardName(board)]))

  const {
    control,
    handleSubmit,
    setValue,
    formState: { isSubmitting, errors },
  } = useForm<CreateTicketIn, unknown, CreateTicketOut>({
    resolver: zodResolver(scCreateTicket),
    mode: 'onChange',
    defaultValues: {
      boardId: defaultBoardId ?? options.privateBoardId,
      title: '',
      content: '',
      status: 'todo',
      priority: null,
      dueDate: null,
      tagIds: [],
      assigneeId: null,
    },
  })

  const boardId = useWatch({ control, name: 'boardId' })
  const [boardAssignees, setBoardAssignees] = useState<Record<string, string>>({})
  // タグは選択中のボードのものだけを候補にする(他ボードのタグはサーバー側で弾かれる)
  const boardTags = options.tags.filter((tag) => tag.boardId === boardId)

  useEffect(() => {
    parseAction(getAssigneeOptions({ id: boardId }))
      .then((res) => setBoardAssignees(res ?? {}))
      .catch(() => setBoardAssignees({}))
  }, [boardId])

  // ボードが変わったら前のボードの担当者・タグの ID が残らないようクリアする
  useEffect(() => {
    setValue('assigneeId', null)
    setValue('tagIds', [])
  }, [boardId, setValue])

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
      <GridBox>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            variant='secondary'
            name='title'
            constraintSchema={scCreateTicket}
            label={t('title')}
            errorMessage={fet(errors.title)}
            autoFocus
            isSmart
          />
        </div>

        <div className='col-span-6 md:col-span-3'>
          <SingleSelectCtrl
            control={control}
            name='boardId'
            variant='secondary'
            groupOptions={boardOptions}
            label={t('board')}
            isSmart
          />
        </div>
        <div className='col-span-6 md:col-span-2'>
          <SingleSelectCtrl
            control={control}
            name='status'
            variant='secondary'
            groupOptions={statusOptions}
            label={t('status')}
            isSmart
          />
        </div>
        <div className='col-span-6 md:col-span-2'>
          <SingleSelectCtrl
            control={control}
            name='priority'
            variant='secondary'
            groupOptions={priorityOptions}
            label={t('priority')}
            isClearable
            isSmart
          />
        </div>
        <div className='col-span-6 md:col-span-2'>
          <SingleSelectCtrl
            control={control}
            name='assigneeId'
            variant='secondary'
            groupOptions={boardAssignees}
            label={t('assignee')}
            isClearable
            isSmart
          />
        </div>
        <div className='col-span-6 md:col-span-3'>
          <DatePickerCtrl
            control={control}
            name='dueDate'
            label={t('due_date')}
            errorMessage={fet(errors.dueDate)}
            isSmart
          />
        </div>

        <div className='col-span-12'>
          <TagSelect
            control={control}
            name='tagIds'
            options={boardTags}
            errorMessage={fet(errors.tagIds)}
            onCreate={async (name) => parseAction(createTicketTag({ boardId, name }))}
            isSmart
          />
        </div>

        <div className='col-span-12'>
          <MarkdownEditor
            control={control}
            name='content'
            constraintSchema={scCreateTicket}
            errorMessage={fet(errors.content)}
          />
        </div>
      </GridBox>
    </FormModal>
  )
}
