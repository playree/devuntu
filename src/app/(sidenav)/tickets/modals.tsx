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
import { SelfAssigneeField } from '@/components/ticket/self-assignee-field'
import { TagInput } from '@/components/ticket/tag-input'
import { useTicketOptions } from '@/components/ticket/ticket-chip'
import { parseAction } from '@/lib/action-client'
import { CreateTicketIn, CreateTicketOut, scCreateTicket } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC, useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { createTicket, getAssigneeOptions, GetTicketFormOptionsReturnType } from './server'

type FormOptions = NonNullable<GetTicketFormOptionsReturnType>

/**
 * チケット作成モーダル。
 * ボードを選ぶとそのボードのメンバーが担当者候補になる(未選択ならプライベートチケットで自分のみ)。
 */
export const AddModal: FC<ModalBaseProps & { options: FormOptions; defaultBoardId?: string | null }> = ({
  state,
  reload,
  options,
  defaultBoardId,
}) => {
  const { t, fet } = useLocale()
  const { statusOptions, priorityOptions } = useTicketOptions()
  const hasBoards = Object.keys(options.boards).length > 0

  const {
    control,
    handleSubmit,
    setValue,
    formState: { isSubmitting, errors },
  } = useForm<CreateTicketIn, unknown, CreateTicketOut>({
    resolver: zodResolver(scCreateTicket),
    mode: 'onChange',
    defaultValues: {
      boardId: defaultBoardId ?? null,
      title: '',
      content: '',
      status: 'todo',
      priority: null,
      dueDate: null,
      tags: [],
      assigneeId: null,
    },
  })

  const boardId = useWatch({ control, name: 'boardId' })
  const [boardAssignees, setBoardAssignees] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!boardId) {
      return
    }
    parseAction(getAssigneeOptions({ id: boardId }))
      .then((res) => setBoardAssignees(res ?? {}))
      .catch(() => setBoardAssignees({}))
  }, [boardId])

  // ボードが変わったら前のボードのメンバーIDが残らないようクリアする
  useEffect(() => {
    setValue('assigneeId', null)
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
            isSlim
          />
        </div>

        {hasBoards && (
          <div className='col-span-12 md:col-span-6'>
            <SingleSelectCtrl
              control={control}
              name='boardId'
              variant='secondary'
              groupOptions={options.boards}
              label={t('board')}
              isClearable
            />
          </div>
        )}
        <div className='col-span-6 md:col-span-3'>
          <SingleSelectCtrl
            control={control}
            name='status'
            variant='secondary'
            groupOptions={statusOptions}
            label={t('status')}
            isSlim
          />
        </div>
        <div className='col-span-6 md:col-span-3'>
          <SingleSelectCtrl
            control={control}
            name='priority'
            variant='secondary'
            groupOptions={priorityOptions}
            label={t('priority')}
            isClearable
            isSlim
          />
        </div>
        <div className='col-span-6 md:col-span-3'>
          {boardId ? (
            <SingleSelectCtrl
              control={control}
              name='assigneeId'
              variant='secondary'
              groupOptions={boardAssignees}
              label={t('assignee')}
              isClearable
              isSlim
            />
          ) : (
            <SelfAssigneeField userName={options.me.name} />
          )}
        </div>
        <div className='col-span-6 md:col-span-3'>
          <DatePickerCtrl
            control={control}
            name='dueDate'
            label={t('due_date')}
            errorMessage={fet(errors.dueDate)}
            isSlim
          />
        </div>

        <div className='col-span-12'>
          <TagInput control={control} name='tags' errorMessage={fet(errors.tags)} suggestions={options.tags} />
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
