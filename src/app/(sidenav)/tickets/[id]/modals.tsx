'use client'

import { MultiButton } from '@/components/general/button'
import { DatePickerCtrl } from '@/components/general/date-picker-ctrl'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input-ctrl'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { SingleSelectCtrl } from '@/components/general/select-ctrl'
import { CheckIcon, PencilSquareIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { MarkdownEditor } from '@/components/ticket/markdown-editor'
import { SelfAssigneeField } from '@/components/ticket/self-assignee-field'
import { TagInput } from '@/components/ticket/tag-input'
import { useTicketOptions } from '@/components/ticket/ticket-chip'
import { parseAction } from '@/lib/action-client'
import { utcToDateOnly } from '@/lib/day'
import { scUpdateTicket, UpdateTicketIn, UpdateTicketOut } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { GetTicketReturnType, updateTicket } from './server'

type Ticket = NonNullable<GetTicketReturnType>

/**
 * チケット更新モーダル。
 * ボードの付け替えは行わない(スコープの変更は不変条件に関わるため対象外)。
 */
export const UpdateModal: FC<
  ModalBaseProps & {
    target: Ticket
    /** ボードチケットの担当者候補(ボードメンバー) */
    assigneeOptions: Record<string, string>
    /** ログインユーザー。プライベートチケットの担当者表示に使う */
    me: { id: string; name: string }
    tagSuggestions: string[]
  }
> = ({ state, reload, target, assigneeOptions, me, tagSuggestions }) => {
  const { t, fet } = useLocale()
  const { statusOptions, priorityOptions } = useTicketOptions()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<UpdateTicketIn, unknown, UpdateTicketOut>({
    resolver: zodResolver(scUpdateTicket),
    mode: 'onChange',
    defaultValues: {
      id: target.id,
      title: target.title,
      content: target.content ?? '',
      status: target.status,
      priority: target.priority,
      dueDate: utcToDateOnly(target.dueDate),
      tags: target.tags,
      assigneeId: target.assigneeId,
    },
  })

  return (
    <FormModal
      state={state}
      size='lg'
      onSubmit={handleSubmit(async (req) => {
        const res = await parseAction(updateTicket(req))
        notify.success(t('msg_updated_target', { target: res.title }))
        reload()
        state.close()
      })}
      title={{ text: t('update_ticket'), icon: <PencilSquareIcon /> }}
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
            constraintSchema={scUpdateTicket}
            label={t('title')}
            errorMessage={fet(errors.title)}
            autoFocus
          />
        </div>

        <div className='col-span-12 md:col-span-6'>
          <SingleSelectCtrl
            control={control}
            name='status'
            variant='secondary'
            groupOptions={statusOptions}
            label={t('status')}
          />
        </div>
        <div className='col-span-12 md:col-span-6'>
          <SingleSelectCtrl
            control={control}
            name='priority'
            variant='secondary'
            groupOptions={priorityOptions}
            label={t('priority')}
            isClearable
          />
        </div>
        <div className='col-span-12 md:col-span-6'>
          {target.boardId ? (
            <SingleSelectCtrl
              control={control}
              name='assigneeId'
              variant='secondary'
              groupOptions={assigneeOptions}
              label={t('assignee')}
              isClearable
            />
          ) : (
            <SelfAssigneeField userName={me.name} />
          )}
        </div>
        <div className='col-span-12 md:col-span-6'>
          <DatePickerCtrl control={control} name='dueDate' label={t('due_date')} errorMessage={fet(errors.dueDate)} />
        </div>

        <div className='col-span-12'>
          <TagInput control={control} name='tags' errorMessage={fet(errors.tags)} suggestions={tagSuggestions} />
        </div>

        <div className='col-span-12'>
          <MarkdownEditor
            control={control}
            name='content'
            constraintSchema={scUpdateTicket}
            errorMessage={fet(errors.content)}
          />
        </div>
      </GridBox>
    </FormModal>
  )
}
