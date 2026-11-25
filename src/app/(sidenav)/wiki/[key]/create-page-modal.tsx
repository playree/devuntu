'use client'

import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { usePushIfLeavable } from '@/components/general/leave-guard'
import { FormModal, type ModalBaseProps } from '@/components/general/modal'
import { SingleSelectCtrl, SingleSelectField } from '@/components/general/select'
import { DocumentPlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { useWikiPageTypeOptions } from '@/components/wiki-chip'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { authClient } from '@/lib/auth/auth-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { ClientError } from '@/lib/error'
import { type CreateWikiPage, scCreateWikiPage } from '@/lib/schema/schema-wiki'
import {
  canChooseWikiPageType,
  defaultWikiPageType,
  EDIT_QUERY,
  wikiPagePath,
  wikiSpaceTypeSpec,
} from '@/lib/wiki/wiki-rule'
import { applyWikiTemplatePlaceholders } from '@/lib/wiki/wiki-template-rule'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { createWikiPage, getWikiTemplateOptions } from './server'
import { useWikiSpace } from './space-context'

/**
 * ページの作成。タイトルと種類を入れて作り、作ったページへ移って本文の編集を始める。
 * テンプレートを選ぶと、タイトル(プレースホルダーを置き換えたもの。空のテンプレートなら入力のまま)と種類を埋め、
 * 本文はサーバーがテンプレートから作る。種類はテンプレートのもので固定する
 */
export const CreatePageModal: FC<ModalBaseProps & { parent: { id: string; title: string } | null }> = ({
  state,
  reload,
  parent,
}) => {
  const { t, fet } = useLocale()
  const { space, access } = useWikiSpace()
  const pushIfLeavable = usePushIfLeavable()
  const typeOptions = useWikiPageTypeOptions()
  const { data: session } = authClient.useSession()
  const timezone = useUserTimezone()
  // 開いたときだけ引く(閉じている間もマウントされ、書けない人の画面にも置かれる)
  const { data: templates } = useActionData(() => getWikiTemplateOptions({ id: space.id }), {
    skip: !state.isOpen || !access.canWrite,
    key: space.id,
  })
  const templateOptions = Object.fromEntries((templates ?? []).map((template) => [template.id, template.name]))

  const {
    control,
    handleSubmit,
    setValue,
    formState: { isSubmitting, errors },
  } = useForm<CreateWikiPage>({
    resolver: zodResolver(scCreateWikiPage),
    mode: 'onChange',
    defaultValues: {
      spaceId: space.id,
      parentId: parent?.id ?? null,
      title: '',
      type: defaultWikiPageType(space.type),
    },
  })
  const templateId = useWatch({ control, name: 'templateId' })

  const applyTemplate = (id: string | null) => {
    const template = templates?.find((row) => row.id === id)
    setValue('templateId', template?.id)
    if (!template) {
      return
    }
    setValue('type', template.type)
    if (template.title) {
      const title = applyWikiTemplatePlaceholders(template.title, {
        now: new Date(),
        timezone,
        userName: session?.user.name ?? '',
      })
      setValue('title', title, { shouldValidate: true })
    }
  }

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        try {
          const res = await parseAction(createWikiPage(req))
          notify.success(t('msg_added_target', { target: req.title }))
          reload()
          state.close()
          // 編集中のページから子ページを作ったときは、下書きを捨てて移るかを確かめる(断ればページだけ作られる)
          await pushIfLeavable(`${wikiPagePath({ key: space.key, number: res.number })}?${EDIT_QUERY}=1`)
        } catch (e) {
          // 深さの上限などは parseAction が通知済み。入力し直してもらうため画面はそのまま残す
          if (!(e instanceof ClientError)) {
            throw e
          }
        }
      })}
      title={{
        text: parent
          ? t('wiki_add_child_page')
          : wikiSpaceTypeSpec(space.type).announce
            ? t('wiki_new_announcement')
            : t('wiki_add_page'),
        icon: <DocumentPlusIcon />,
      }}
      submit={{ isPending: isSubmitting }}
    >
      <GridBox>
        {parent && (
          <p className='text-muted col-span-12 truncate text-sm'>{t('wiki_parent_page', { title: parent.title })}</p>
        )}
        {templates && templates.length > 0 && (
          <div className='col-span-12'>
            <SingleSelectField
              groupOptions={templateOptions}
              label={t('template_label')}
              placeholder={t('template_label')}
              value={templateId ?? null}
              onChange={applyTemplate}
              isClearable
            />
          </div>
        )}
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            name='title'
            constraintSchema={scCreateWikiPage}
            label={t('wiki_page_title')}
            errorMessage={fet(errors.title)}
            autoFocus
          />
        </div>
        {canChooseWikiPageType(space.type) && ( // 種類が 1 つしか無い区分では選ばせない
          <div className='col-span-12'>
            <SingleSelectCtrl
              control={control}
              name='type'
              groupOptions={typeOptions}
              label={t('wiki_page_type')}
              isDisabled={!!templateId}
            />
          </div>
        )}
        {templateId && <p className='text-muted col-span-12 text-xs'>{t('msg_wiki_page_from_template')}</p>}
      </GridBox>
    </FormModal>
  )
}
