'use client'

import { MultiButton } from '@/components/general/button'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { FormModal, useModalState } from '@/components/general/modal'
import { NoticePanel } from '@/components/general/panel'
import { SingleSelectCtrl } from '@/components/general/select'
import { DocumentDuplicateIcon, PencilSquareIcon, PlusIcon, TrashIcon } from '@/components/icon'
import { MarkdownCtrl } from '@/components/markdown/markdown-editor'
import { notify } from '@/components/notify'
import {
  CriteriaRowsField,
  type CriterionDraftRow,
  filledCriterionRows,
  isValidCriterionRows,
  toCriterionDraftRows,
} from '@/components/ticket/criteria-rows-field'
import { TagSelectCtrl, type TagSelectOption } from '@/components/ticket/tag-id-select'
import { PriorityChip, TagChips } from '@/components/ticket/ticket-chip'
import { useTicketOptions } from '@/components/ticket/ticket-options'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { MAX_TEMPLATES_PER_BOARD } from '@/lib/board/ticket-template-rule'
import {
  scTicketTemplateFields,
  type TicketTemplateFields,
  type TicketTemplateFieldsIn,
} from '@/lib/schema/schema-ticket-template'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC, useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  createBoardTicketTemplate,
  deleteBoardTicketTemplate,
  getBoardTicketTemplates,
  type GetBoardTicketTemplatesReturnType,
  updateBoardTicketTemplate,
} from './server'

type Template = NonNullable<GetBoardTicketTemplatesReturnType>[number]

/** 追加 / 編集のモーダル。受け入れ条件は行の並べ替えがあるため react-hook-form の外で持つ */
const TemplateModal: FC<{
  state: ReturnType<typeof useModalState<Template>>
  boardId: string
  tags: TagSelectOption[]
  reload: () => void
}> = ({ state, boardId, tags, reload }) => {
  const { t, fet } = useLocale()
  const { priorityOptions } = useTicketOptions()
  const template = state.target
  const [criteria, setCriteria] = useState<CriterionDraftRow[]>(() => toCriterionDraftRows(template?.criteria ?? []))

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<TicketTemplateFieldsIn, unknown, TicketTemplateFields>({
    resolver: zodResolver(scTicketTemplateFields),
    mode: 'onChange',
    defaultValues: {
      name: template?.name ?? '',
      content: template?.content ?? '',
      criteria: [],
      tagIds: template?.tagIds ?? [],
      priority: template?.priority ?? null,
    },
  })

  return (
    <FormModal
      state={state}
      size='5xl'
      onSubmit={handleSubmit(async (req) => {
        const fields = { ...req, criteria: filledCriterionRows(criteria).map((row) => row.text) }
        const res = await parseAction(
          template
            ? updateBoardTicketTemplate({ id: template.id, ...fields })
            : createBoardTicketTemplate({ boardId, ...fields }),
        )
        notify.success(t(template ? 'msg_updated_target' : 'msg_added_target', { target: res.name }))
        reload()
        state.close()
      })}
      title={{
        text: t(template ? 'update_ticket_template' : 'add_ticket_template'),
        icon: template ? <PencilSquareIcon /> : <PlusIcon />,
      }}
      submit={{ isPending: isSubmitting, isDisabled: !isValidCriterionRows(criteria) }}
    >
      <GridBox isSmart>
        <div className='col-span-12 md:col-span-6'>
          <InputCtrl
            control={control}
            name='name'
            constraintSchema={scTicketTemplateFields}
            label={t('ticket_template_name')}
            errorMessage={fet(errors.name)}
            autoFocus
          />
        </div>
        <div className='col-span-12 md:col-span-2'>
          <SingleSelectCtrl
            control={control}
            name='priority'
            groupOptions={priorityOptions}
            label={t('priority')}
            isClearable
          />
        </div>
        <div className='col-span-12 md:col-span-4'>
          <TagSelectCtrl control={control} name='tagIds' options={tags} errorMessage={fet(errors.tagIds)} />
        </div>

        <div className='col-span-12'>
          <MarkdownCtrl
            allowImages
            control={control}
            name='content'
            constraintSchema={scTicketTemplateFields}
            errorMessage={fet(errors.content)}
            uploadBoardId={boardId}
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

const TemplateRow: FC<{
  template: Template
  tags: TagSelectOption[]
  canManage: boolean
  onEdit: () => void
  onDelete: () => void
}> = ({ template, tags, canManage, onEdit, onDelete }) => {
  const { t } = useLocale()
  const templateTags = tags.filter((tag) => template.tagIds.includes(tag.id))

  return (
    <div className='flex items-start gap-2 rounded-xl border-2 px-2 py-1'>
      <div className='min-w-0 grow space-y-1'>
        <div className='text-sm font-medium wrap-break-word'>{template.name}</div>
        <div className='text-muted flex flex-wrap items-center gap-2 text-xs'>
          {template.priority && <PriorityChip value={template.priority} />}
          {templateTags.length > 0 && <TagChips tags={templateTags} />}
          <span>
            {t('acceptance_criteria')}: {template.criteria.length}
          </span>
        </div>
      </div>
      {canManage && (
        <div className='flex shrink-0 items-center gap-0.5'>
          <MultiButton
            isIconOnly
            size='sm'
            variant='ghost'
            tooltip={t('update')}
            icon={<PencilSquareIcon width={16} />}
            onPress={onEdit}
          />
          <MultiButton
            isIconOnly
            size='sm'
            variant='ghost'
            tooltip={t('delete')}
            icon={<TrashIcon width={16} />}
            onPress={onDelete}
          />
        </div>
      )}
    </div>
  )
}

/**
 * チケットテンプレート。閲覧はメンバー全員、追加・編集・削除は owner と管理者(`canManage`)。
 */
export const BoardTicketTemplates: FC<{ boardId: string; tags: TagSelectOption[]; canManage: boolean }> = ({
  boardId,
  tags,
  canManage,
}) => {
  const { t } = useLocale()
  const confirmAction = useConfirmAction()
  const modalState = useModalState<Template>()
  const { data: templates, refresh } = useActionData(() => getBoardTicketTemplates({ id: boardId }))

  const list = templates ?? []

  const remove = (template: Template) =>
    confirmAction(
      { title: t('confirm_deletion'), text: t('msg_confirm_deletion', { target: template.name }) },
      async () => {
        await parseAction(deleteBoardTicketTemplate({ id: template.id }))
        notify.success(t('msg_deleted_target', { target: template.name }))
        refresh()
      },
    )

  return (
    <div className='space-y-2'>
      <NoticePanel className='text-xs'>{t('msg_ticket_template_desc')}</NoticePanel>

      {canManage && (
        <MultiButton
          size='sm'
          variant='outline'
          icon={<PlusIcon width={16} />}
          isDisabled={list.length >= MAX_TEMPLATES_PER_BOARD}
          onPress={() => modalState.open()}
        >
          {t('add_ticket_template')}
        </MultiButton>
      )}

      {list.length === 0 ? (
        <div className='text-muted flex items-center gap-1 px-1 text-sm'>
          <DocumentDuplicateIcon width={16} />
          {t('msg_no_ticket_templates')}
        </div>
      ) : (
        <div className='space-y-1'>
          {list.map((template) => (
            <TemplateRow
              key={template.id}
              template={template}
              tags={tags}
              canManage={canManage}
              onEdit={() => modalState.open(template)}
              onDelete={() => remove(template)}
            />
          ))}
        </div>
      )}

      {canManage && (
        <TemplateModal key={modalState.key} state={modalState} boardId={boardId} tags={tags} reload={refresh} />
      )}
    </div>
  )
}
