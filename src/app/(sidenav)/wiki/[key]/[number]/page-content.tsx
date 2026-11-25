import { PanelSpinner } from '@/components/general/panel'
import { DesignDocView } from '@/components/markdown/design-doc-view'
import { MarkdownField } from '@/components/markdown/markdown-editor'
import { MarkdownToc } from '@/components/markdown/markdown-toc'
import { WikiContentEditor } from '@/components/markdown/wiki-content-editor'
import { TextDiffView } from '@/components/text-diff-view'
import { useLocale } from '@/locale/client'
import { FC, useRef } from 'react'
import { WikiPageEditControls } from './page-toolbar'
import type { GetWikiPageReturnType } from './server'
import type { WikiPageEditor } from './use-page-editor'
import type { WikiPageRevision } from './use-wiki-page-revisions'

type Page = NonNullable<GetWikiPageReturnType>['page']

export const WikiPageContent: FC<{
  page: Page
  past: WikiPageRevision | undefined
  shownContent: string | undefined
  isDesignDoc: boolean
  isDiff: boolean
  onCloseDiff: () => void
  updatedText: string
  editor: WikiPageEditor
}> = ({ page, past, shownContent, isDesignDoc, isDiff, onCloseDiff, updatedText, editor }) => {
  const { t } = useLocale()
  const contentRef = useRef<HTMLDivElement>(null)
  const isDesignDocView = isDesignDoc && !editor.isEditing
  let body

  if (editor.isEditing) {
    body = (
      <WikiContentEditor
        key={editor.editorKey}
        type={editor.typeDraft}
        initialValue={editor.editorBase}
        onChange={editor.changeContent}
        documentId={page.id}
        length={editor.contentDraft.length}
        isLabelHidden
        info={<p className='text-muted text-xs'>{updatedText}</p>}
        minRows={6}
        spaceId={page.spaceId}
        onUploadingChange={editor.setUploading}
        footer={<WikiPageEditControls editor={editor} />}
      />
    )
  } else if (shownContent === undefined) {
    body = <PanelSpinner />
  } else if (past && isDiff && isDesignDoc) {
    body = (
      <DesignDocView
        className='border-default-200 absolute inset-0 overflow-hidden rounded-xl border'
        markdown={page.content}
        compareWith={shownContent}
        compareLabel={t('wiki_diff_compare_label', { version: `v${past.number}` })}
        onCloseDiff={onCloseDiff}
        documentId={`${page.id}:${past.id}:diff`}
      />
    )
  } else if (isDiff) {
    body =
      shownContent === page.content ? (
        <p className='text-muted text-sm'>{t('msg_wiki_diff_no_change')}</p>
      ) : (
        <TextDiffView before={shownContent} after={page.content} />
      )
  } else if (isDesignDoc) {
    body = (
      <DesignDocView
        className='border-default-200 absolute inset-0 overflow-hidden rounded-xl border'
        markdown={shownContent}
        documentId={past ? `${page.id}:${past.id}` : page.id}
      />
    )
  } else {
    body = (
      <MarkdownField
        body={shownContent}
        isEditing={false}
        defaultValue={shownContent}
        onChange={() => {}}
        length={shownContent.length}
        label={t('content')}
        isLabelHidden
      />
    )
  }

  return (
    <>
      <div
        ref={contentRef}
        // 設計書の表示は、ページ側(data-fill-screen を見て画面 1 枚分の高さを持つ)の残りを埋める
        data-fill-screen={isDesignDocView ? '' : undefined}
        className={isDesignDocView ? 'relative min-h-96 flex-1' : 'py-2'}
      >
        {body}
      </div>
      {!editor.isEditing && !isDesignDoc && !isDiff && <MarkdownToc targetRef={contentRef} />}
    </>
  )
}
