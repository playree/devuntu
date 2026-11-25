'use client'

import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { FormModal, useModalState } from '@/components/general/modal'
import { SingleSelectCtrl } from '@/components/general/select'
import { PencilSquareIcon, PlusIcon } from '@/components/icon'
import { MarkdownCtrl } from '@/components/markdown/markdown-editor'
import { notify } from '@/components/notify'
import { TagChips } from '@/components/tag/tag-chip'
import { TagSelectCtrl, type TagSelectOption } from '@/components/tag/tag-id-select'
import { TemplateListEditor } from '@/components/template-list-editor'
import {
  CriteriaRowsField,
  type CriterionDraftRow,
  filledCriterionRows,
  isValidCriterionRows,
  toCriterionDraftRows,
} from '@/components/ticket/criteria-rows-field'
import { PriorityChip } from '@/components/ticket/ticket-chip'
import { useTicketOptions } from '@/components/ticket/ticket-options'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { MAX_TEMPLATES_PER_BOARD } from '@/lib/board/ticket-template-rule'
import {
  scTicketTemplateFields,
  type TicketTemplateFields,
  type TicketTemplateFieldsIn,
} from '@/lib/schema/schema-ticket-template'
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
        text: t(template ? 'template_update' : 'template_add'),
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
            label={t('template_name')}
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
            uploadOwner={{ kind: 'board', boardId }}
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

export const BoardTicketTemplates: FC<{ boardId: string; tags: TagSelectOption[]; canManage: boolean }> = ({
  boardId,
  tags,
  canManage,
}) => {
  const { t } = useLocale()
  const { data: templates, refresh } = useActionData(() => getBoardTicketTemplates({ id: boardId }))

  return (
    <TemplateListEditor
      templates={templates ?? []}
      description={t('msg_ticket_template_desc')}
      limit={MAX_TEMPLATES_PER_BOARD}
      canManage={canManage}
      onDelete={(id) => parseAction(deleteBoardTicketTemplate({ id }))}
      reload={refresh}
      renderDetails={(template) => {
        const templateTags = tags.filter((tag) => template.tagIds.includes(tag.id))
        return (
          <div className='text-muted flex flex-wrap items-center gap-2 text-xs'>
            {template.priority && <PriorityChip value={template.priority} />}
            {templateTags.length > 0 && <TagChips tags={templateTags} />}
            <span>
              {t('acceptance_criteria')}: {template.criteria.length}
            </span>
          </div>
        )
      }}
      renderModal={(state) => <TemplateModal state={state} boardId={boardId} tags={tags} reload={refresh} />}
    />
  )
}
