import { MultiButton, SubmitButtons } from '@/components/general/button'
import { InputField } from '@/components/general/input'
import { CheckIcon, PencilSquareIcon } from '@/components/icon'
import { WikiTagLinks } from '@/components/wiki-tag'
import { MAX_WIKI_REVISION_MESSAGE } from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { ComponentProps, FC } from 'react'
import { useWikiSpace } from '../space-context'
import { WikiPageEditHeader } from './page-edit-header'
import { WikiExportMenu } from './page-export'
import { WikiRevisionDeleteButton, WikiRevisionDiffToggle, WikiRevisionRestoreButton } from './revision-actions'
import { WikiRevisionSelect } from './revision-select'
import type { GetWikiPageReturnType } from './server'
import type { WikiPageEditor } from './use-page-editor'
import type { WikiPageRevisions } from './use-wiki-page-revisions'

type Page = NonNullable<GetWikiPageReturnType>['page']

export const WikiPageToolbar: FC<{
  pageNumber: Page['number']
  pageId: Page['id']
  shown: Pick<Page, 'title' | 'type'> & { tags: ComponentProps<typeof WikiTagLinks>['tags'] }
  shownContent: string | undefined
  isDesignDoc: boolean
  updatedText: string
  canWrite: boolean
  canDeleteRevision: boolean
  editor: WikiPageEditor
  revisions: WikiPageRevisions
}> = ({
  pageNumber,
  pageId,
  shown,
  shownContent,
  isDesignDoc,
  updatedText,
  canWrite,
  canDeleteRevision,
  editor,
  revisions,
}) => {
  const { t } = useLocale()
  const { space } = useWikiSpace()
  const { isEditing } = editor
  const editAction = !isEditing && canWrite && !revisions.past && (
    <MultiButton
      isIconOnly
      size='sm'
      variant='outline'
      tooltip={t('update')}
      icon={<PencilSquareIcon width={16} />}
      onPress={editor.startEditing}
    />
  )

  return (
    <div
      // 設計書は図と見出しを横に並べるため、幅の制限(max-w-4xl)を外す
      data-wide={isDesignDoc ? '' : undefined}
      className='space-y-1'
    >
      {isEditing ? (
        <WikiPageEditHeader
          title={editor.titleDraft}
          onTitleChange={editor.setTitleDraft}
          type={editor.typeDraft}
          onTypeChange={editor.changeType}
          isTypeDisabled={editor.isUploading}
          tagIds={editor.tagIdsDraft}
          onTagIdsChange={editor.setTagIdsDraft}
        />
      ) : (
        <div className='flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1'>
          <h1 className='min-w-0 text-2xl font-bold wrap-break-word'>{shown.title}</h1>
          <WikiTagLinks spaceKey={space.key} tags={shown.tags} />
          <div // 差分・編集・戻す・出力・削除は版の選択のすぐ右に置き、版に対する操作だと分かるようにする(タイトルの後で折り返しても離さない。幅が足りなければこの中で折り返す)
            className='flex flex-wrap items-center gap-2'
          >
            <WikiRevisionSelect revisions={revisions} updatedText={updatedText} />
            <WikiRevisionDiffToggle revisions={revisions} />
            {editAction}
            {canWrite && <WikiRevisionRestoreButton revisions={revisions} />}
            <WikiExportMenu // ページを移ったら作り直す(作っている途中の HTML 出力を打ち切り、移った先で保存しない)
              key={pageId}
              spaceKey={space.key}
              number={pageNumber}
              title={shown.title}
              type={shown.type}
              content={shownContent}
              revision={revisions.past}
            />
            {canDeleteRevision && <WikiRevisionDeleteButton revisions={revisions} />}
          </div>
        </div>
      )}
    </div>
  )
}

export const WikiPageEditControls: FC<{ editor: WikiPageEditor }> = ({ editor }) => {
  const { t } = useLocale()

  return (
    <div // スマホ幅ではコミットメッセージを1行に取り、ボタンをその下に置く
      className='flex w-full flex-wrap items-center justify-end gap-2'
    >
      <div className='w-full min-w-0 sm:w-auto sm:flex-1'>
        <InputField // 版に残すコミットメッセージ(任意)
          isSmart
          isLabelHidden
          label={t('wiki_revision_message')}
          placeholder={t('wiki_revision_message')}
          value={editor.messageDraft}
          onChange={(e) => editor.setMessageDraft(e.target.value)}
          maxLength={MAX_WIKI_REVISION_MESSAGE}
        />
      </div>
      <SubmitButtons
        size='sm'
        label={t('save')}
        icon={<CheckIcon width={16} />}
        isPending={editor.isSaving}
        isDisabled={!editor.isSubmittable}
        onPress={() => editor.save()}
        onCancel={editor.cancelEditing}
      />
    </div>
  )
}
