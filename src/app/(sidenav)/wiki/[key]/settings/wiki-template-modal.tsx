import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { FormModal, type useModalState } from '@/components/general/modal'
import { SingleSelectCtrl } from '@/components/general/select'
import { PencilSquareIcon, PlusIcon } from '@/components/icon'
import { WikiContentEditor } from '@/components/markdown/wiki-content-editor'
import { notify } from '@/components/notify'
import { useWikiPageTypeOptions } from '@/components/wiki-chip'
import { parseAction } from '@/lib/action/action-client'
import { scWikiTemplateFields, type WikiTemplateFields, type WikiTemplateFieldsIn } from '@/lib/schema/schema-wiki'
import { canChooseWikiPageType, defaultWikiPageType } from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import type { WikiSpaceContextValue } from '../space-context'
import { createWikiTemplate, updateWikiTemplate, type GetWikiTemplatesReturnType } from './server'

type Space = WikiSpaceContextValue['space']
type Template = NonNullable<GetWikiTemplatesReturnType>[number]

/**
 * 追加 / 編集のモーダル。本文は種類に合わせて、通常ページはリッチエディタ、設計書はソースとプレビューで編集する。
 * 設計書スペースでは種類を設計書に固定する
 */
export const WikiTemplateModal: FC<{
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
        text: t(template ? 'template_update' : 'template_add'),
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
            label={t('template_name')}
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
          <WikiContentEditor
            key={type}
            type={type}
            initialValue={editorBase}
            onChange={changeContent}
            documentId={`wiki-template:${template?.id ?? 'new'}`}
            length={content.length}
            minRows={8}
            spaceId={space.id}
            onUploadingChange={setUploading}
          />
          {errors.content && <p className='text-danger text-xs'>{fet(errors.content)}</p>}
        </div>
      </GridBox>
    </FormModal>
  )
}
