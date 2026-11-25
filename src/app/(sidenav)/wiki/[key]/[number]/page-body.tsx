'use client'

import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { wikiPagePath } from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { FC } from 'react'
import { useWikiSpace } from '../space-context'
import { WikiPageConflictModal } from './page-conflict-modal'
import { WikiPageContent } from './page-content'
import { WikiPageToolbar } from './page-toolbar'
import { WikiPastRevisionNotice } from './revision-actions'
import { WikiRevisionFieldChanges } from './revision-field-changes'
import type { GetWikiPageReturnType } from './server'
import { useWikiPageEditor } from './use-page-editor'
import { usePastPageView, useWikiPageRevisions } from './use-wiki-page-revisions'

type Page = NonNullable<GetWikiPageReturnType>['page']

/** ページの編集状態と選んだ版を、操作欄と本文で共有する */
export const WikiPageBody: FC<{
  page: Page
  canWrite: boolean
  canDeleteRevision: boolean
  onSaved: () => Promise<void>
}> = ({ page, canWrite, canDeleteRevision, onSaved }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const { space } = useWikiSpace()
  const editor = useWikiPageEditor(page, canWrite, onSaved)
  const revisions = useWikiPageRevisions(page, onSaved)
  const past = editor.isEditing ? undefined : revisions.past
  const pastView = usePastPageView(past)
  const latest = { title: page.title, type: page.type, tags: page.tags.map(({ tag }) => tag) }
  const shown = pastView ?? latest
  const shownContent = past ? revisions.pastContent : page.content
  const isDiff = !!past && revisions.isDiff
  // 差分は最新の種類で表示する。過去の版だけを表示するときは、その版の種類を使う
  const isDesignDoc = (editor.isEditing ? editor.typeDraft : isDiff ? page.type : shown.type) === 'design_doc'
  const updatedBy = page.updatedBy?.name ?? page.createdBy?.name
  const updatedText = t('wiki_updated_by', { name: updatedBy ?? '-', at: dayformat(page.updatedAt, 'tz-minute', tz) })

  return (
    <>
      <WikiPageToolbar
        pageId={page.id}
        pageNumber={page.number}
        shown={shown}
        shownContent={shownContent}
        isDesignDoc={isDesignDoc}
        updatedText={updatedText}
        canWrite={canWrite}
        canDeleteRevision={canDeleteRevision}
        editor={editor}
        revisions={revisions}
      />
      {!editor.isEditing && <WikiPastRevisionNotice revisions={revisions} />}
      {isDiff && pastView && (
        <WikiRevisionFieldChanges before={{ ...pastView, tags: pastView.revisionTags }} after={latest} />
      )}
      <WikiPageContent
        page={page}
        past={past}
        shownContent={shownContent}
        isDesignDoc={isDesignDoc}
        isDiff={isDiff}
        onCloseDiff={() => revisions.setDiff(false)}
        updatedText={updatedText}
        editor={editor}
      />
      <WikiPageConflictModal
        state={editor.conflictState}
        href={wikiPagePath({ key: space.key, number: page.number })}
        content={editor.contentDraft}
        isSaving={editor.isSaving}
        isSubmittable={editor.isSubmittable}
        onOverwrite={editor.overwrite}
      />
    </>
  )
}
