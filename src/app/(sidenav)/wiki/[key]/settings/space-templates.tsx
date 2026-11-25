'use client'

import { MultiButton } from '@/components/general/button'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { FormModal, useModalState } from '@/components/general/modal'
import { NoticePanel } from '@/components/general/panel'
import { SingleSelectCtrl } from '@/components/general/select'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DocumentDuplicateIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
} from '@/components/icon'
import { DesignDocEditor } from '@/components/markdown/design-doc-editor'
import { MarkdownField } from '@/components/markdown/markdown-editor'
import { notify } from '@/components/notify'
import { useWikiPageTypeOptions, WikiPageTypeChip } from '@/components/wiki-chip'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { scWikiTemplateFields, type WikiTemplateFields, type WikiTemplateFieldsIn } from '@/lib/schema/schema-wiki'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { canChooseWikiPageType, defaultWikiPageType, MAX_WIKI_CONTENT } from '@/lib/wiki/wiki-rule'
import { MAX_WIKI_TEMPLATES_PER_SPACE } from '@/lib/wiki/wiki-template-rule'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { type WikiSpaceContextValue } from '../space-context'
import {
  createWikiTemplate,
  deleteWikiTemplate,
  getWikiTemplates,
  type GetWikiTemplatesReturnType,
  moveWikiTemplate,
  updateWikiTemplate,
} from './server'

type Space = WikiSpaceContextValue['space']
type Template = NonNullable<GetWikiTemplatesReturnType>[number]

/**
 * 追加 / 編集のモーダル。本文は種類に合わせて、通常ページはリッチエディタ、設計書はソースとプレビューで編集する。
 * 設計書スペースでは種類を設計書に固定する
 */
const TemplateModal: FC<{
  state: ReturnType<typeof useModalState<Template>>
  space: Space
  reload: () => void
}> = ({ state, space, reload }) => {
  const { t, fet } = useLocale()
  const typeOptions = useWikiPageTypeOptions()
  const canChooseType = canChooseWikiPageType(space.type)
  const template = state.target
  const [isUploading, setUploading] = useState(false)

  const {
    control,
    handleSubmit,
    setValue,
    formState: { isSubmitting, errors },
  } = useForm<WikiTemplateFieldsIn, unknown, WikiTemplateFields>({
    resolver: zodResolver(scWikiTemplateFields),
    mode: 'onChange',
    defaultValues: {
      name: template?.name ?? '',
      title: template?.title ?? '',
      content: template?.content ?? '',
      type: template?.type ?? defaultWikiPageType(space.type),
    },
  })
  const type = useWatch({ control, name: 'type' })
  const content = useWatch({ control, name: 'content' }) ?? ''
  // どちらのエディタも初回の値しか取り込まないので、種類を切り替えたらその時点の本文で作り直す
  const [editor, setEditor] = useState({ type, base: content })
  if (editor.type !== type) {
    setEditor({ type, base: content })
  }
  const editorBase = editor.base
  const changeContent = (markdown: string) => setValue('content', markdown, { shouldValidate: true })

  return (
    <FormModal
      state={state}
      size='5xl'
      onSubmit={handleSubmit(async (req) => {
        const res = await parseAction(
          template
            ? updateWikiTemplate({ id: template.id, ...req })
            : createWikiTemplate({ spaceId: space.id, ...req }),
        )
        notify.success(t(template ? 'msg_updated_target' : 'msg_added_target', { target: res.name }))
        reload()
        state.close()
      })}
      title={{
        text: t(template ? 'update_ticket_template' : 'add_ticket_template'),
        icon: template ? <PencilSquareIcon /> : <PlusIcon />,
      }}
      submit={{ isPending: isSubmitting, isDisabled: isUploading }}
    >
      <GridBox isSmart>
        <div className='col-span-12 md:col-span-4'>
          <InputCtrl
            control={control}
            name='name'
            constraintSchema={scWikiTemplateFields}
            label={t('ticket_template_name')}
            errorMessage={fet(errors.name)}
            autoFocus
          />
        </div>
        <div className={canChooseType ? 'col-span-12 md:col-span-5' : 'col-span-12 md:col-span-8'}>
          <InputCtrl
            control={control}
            name='title'
            constraintSchema={scWikiTemplateFields}
            label={t('wiki_template_title')}
            errorMessage={fet(errors.title)}
          />
        </div>
        {canChooseType && ( // 種類が 1 つしか無い区分では選ばせない
          <div className='col-span-12 md:col-span-3'>
            <SingleSelectCtrl control={control} name='type' groupOptions={typeOptions} label={t('wiki_page_type')} />
          </div>
        )}
        <p className='text-muted col-span-12 text-xs'>{t('msg_wiki_template_desc')}</p>
        <div className='col-span-12'>
          {type === 'design_doc' ? (
            <DesignDocEditor
              key='design_doc'
              initialValue={editorBase}
              onChange={changeContent}
              documentId={`wiki-template:${template?.id ?? 'new'}`}
              length={content.length}
              maxLength={MAX_WIKI_CONTENT}
              label={t('content')}
              allowImages
              uploadOwner={{ kind: 'wikiSpace', wikiSpaceId: space.id }}
              onUploadingChange={setUploading}
            />
          ) : (
            <MarkdownField
              key='page'
              body={editorBase}
              isEditing
              defaultValue={editorBase}
              onChange={changeContent}
              length={content.length}
              maxLength={MAX_WIKI_CONTENT}
              label={t('content')}
              minRows={8}
              allowImages
              uploadOwner={{ kind: 'wikiSpace', wikiSpaceId: space.id }}
            />
          )}
          {errors.content && <p className='text-danger text-xs'>{fet(errors.content)}</p>}
        </div>
      </GridBox>
    </FormModal>
  )
}

const TemplateRow: FC<{
  template: Template
  isFirst: boolean
  isLast: boolean
  isMoving: boolean
  onMove: (direction: 'up' | 'down') => void
  onEdit: () => void
  onDelete: () => void
}> = ({ template, isFirst, isLast, isMoving, onMove, onEdit, onDelete }) => {
  const { t } = useLocale()

  return (
    <div className='flex items-start gap-2 rounded-xl border-2 px-2 py-1'>
      <div className='min-w-0 grow space-y-1'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-sm font-medium wrap-break-word'>{template.name}</span>
          <WikiPageTypeChip value={template.type} />
        </div>
        <div className='text-muted truncate text-xs'>{template.title || '-'}</div>
      </div>
      <div className='flex shrink-0 items-center gap-0.5'>
        <MultiButton
          isIconOnly
          size='sm'
          variant='ghost'
          tooltip={t('move_up')}
          icon={<ChevronUpIcon width={16} />}
          isDisabled={isFirst || isMoving}
          onPress={() => onMove('up')}
        />
        <MultiButton
          isIconOnly
          size='sm'
          variant='ghost'
          tooltip={t('move_down')}
          icon={<ChevronDownIcon width={16} />}
          isDisabled={isLast || isMoving}
          onPress={() => onMove('down')}
        />
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
    </div>
  )
}

/** スペースのページテンプレート(owner または管理者)。アーカイブ済みのスペースでは変更できない */
export const WikiSpaceTemplates: FC<{ space: Space }> = ({ space }) => {
  const { t } = useLocale()
  const confirmAction = useConfirmAction()
  const modalState = useModalState<Template>()
  const [movingId, setMovingId] = useState<string>()
  const { data: templates, refresh } = useActionData(() => getWikiTemplates({ id: space.id }), { key: space.id })

  if (space.archived) {
    return <p className='text-muted text-sm'>{t('msg_wiki_space_archived')}</p>
  }

  const list = templates ?? []

  const move = async (template: Template, direction: 'up' | 'down') => {
    setMovingId(template.id)
    try {
      await parseAction(moveWikiTemplate({ id: template.id, direction }))
      await refresh()
    } finally {
      setMovingId(undefined)
    }
  }

  const remove = (template: Template) =>
    confirmAction(
      { title: t('confirm_deletion'), text: t('msg_confirm_deletion', { target: template.name }) },
      async () => {
        await parseAction(deleteWikiTemplate({ id: template.id }))
        notify.success(t('msg_deleted_target', { target: template.name }))
        refresh()
      },
    )

  return (
    <div className='space-y-2'>
      <NoticePanel className='text-xs'>{t('msg_wiki_template_desc')}</NoticePanel>

      <MultiButton
        size='sm'
        variant='outline'
        icon={<PlusIcon width={16} />}
        isDisabled={list.length >= MAX_WIKI_TEMPLATES_PER_SPACE}
        onPress={() => modalState.open()}
      >
        {t('add_ticket_template')}
      </MultiButton>

      {list.length === 0 ? (
        <div className='text-muted flex items-center gap-1 px-1 text-sm'>
          <DocumentDuplicateIcon width={16} />
          {t('msg_no_ticket_templates')}
        </div>
      ) : (
        <div className='space-y-1'>
          {list.map((template, index) => (
            <TemplateRow
              key={template.id}
              template={template}
              isFirst={index === 0}
              isLast={index === list.length - 1}
              isMoving={movingId !== undefined}
              onMove={(direction) => move(template, direction)}
              onEdit={() => modalState.open(template)}
              onDelete={() => remove(template)}
            />
          ))}
        </div>
      )}

      <TemplateModal key={modalState.key} state={modalState} space={space} reload={refresh} />
    </div>
  )
}
