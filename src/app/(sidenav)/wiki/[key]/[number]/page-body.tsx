'use client'

import { MultiButton, SubmitButtons } from '@/components/general/button'
import { EditorField } from '@/components/general/editor-field'
import { useConfirmModal } from '@/components/general/modal'
import { CheckIcon, PencilSquareIcon } from '@/components/icon'
import { DesignDocEditor } from '@/components/markdown/design-doc-editor'
import { DesignDocView } from '@/components/markdown/design-doc-view'
import { MarkdownField } from '@/components/markdown/markdown-editor'
import { MarkdownToc } from '@/components/markdown/markdown-toc'
import { notify } from '@/components/notify'
import { WikiTagLinks } from '@/components/wiki-tag'
import type { WikiPageType } from '@/generated/prisma/enums'
import { parseAction } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { ClientError } from '@/lib/error'
import { designDocFrontMatter, hasFrontMatter } from '@/lib/wiki/wiki-markdown'
import { MAX_WIKI_CONTENT, MAX_WIKI_TITLE } from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { FC, useEffect, useRef, useState } from 'react'
import { EDIT_QUERY } from '../page-modals'
import { useWikiSpace } from '../space-context'
import { WikiPageEditHeader } from './page-edit-header'
import { GetWikiPageReturnType, updateWikiPage } from './server'

type Page = NonNullable<GetWikiPageReturnType>['page']

/** 設計書の表示の高さ。ビューアは中でスクロールするので、画面の残りを与える */
const DESIGN_DOC_VIEW_HEIGHT = 'h-[calc(100dvh-12rem)] min-h-96'

/**
 * ページのタイトル・タグ・本文。表示と編集を切り替え、保存したらサーバー値を取り直す。
 * 作成直後(`?edit=1`)は編集から始める。
 * 設計書のページは Markdown Design Doc Viewer で表示し、ソースとプレビューで編集する(幅の制限を外す)
 */
export const WikiPageBody: FC<{ page: Page; canWrite: boolean; onSaved: () => Promise<void> }> = ({
  page,
  canWrite,
  onSaved,
}) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const { space } = useWikiSpace()
  const { confirmModal } = useConfirmModal()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const hasEditQuery = searchParams.get(EDIT_QUERY) === '1'
  // 作成直後は本文の編集から始める(ページごとに作り直されるので、初期値で決めてよい)
  const [isEditing, setEditing] = useState(() => canWrite && hasEditQuery)
  const [titleDraft, setTitleDraft] = useState(page.title)
  const [contentDraft, setContentDraft] = useState(page.content)
  const [typeDraft, setTypeDraft] = useState(page.type)
  /**
   * エディタを開いた時点の本文。エディタはマウント時にだけ取り込むので、編集中は変えない。
   * 種類を切り替えたときは、その時点の下書きで開き直す
   */
  const [editorBase, setEditorBase] = useState(page.content)
  const [editorKey, setEditorKey] = useState(0)
  const pageTagIds = () => page.tags.map(({ tag }) => tag.id)
  const [tagIdsDraft, setTagIdsDraft] = useState(pageTagIds)
  // 競合の判定の基準。編集中にページを取り直しても(移動など)、編集を始めた時点の値で比べる
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(page.updatedAt)
  const [isSaving, setSaving] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  // クエリは消して、再読み込みで編集に戻らないようにする
  useEffect(() => {
    if (hasEditQuery) {
      router.replace(pathname)
    }
  }, [hasEditQuery, pathname, router])

  const startEditing = () => {
    setTitleDraft(page.title)
    setContentDraft(page.content)
    setTypeDraft(page.type)
    setEditorBase(page.content)
    setEditorKey((key) => key + 1)
    setTagIdsDraft(pageTagIds())
    setBaseUpdatedAt(page.updatedAt)
    setEditing(true)
  }

  /** 種類を切り替え、下書きを引き継いでエディタを開き直す */
  const changeType = async (type: WikiPageType) => {
    if (type === typeDraft) {
      return
    }
    let content = contentDraft
    if (type === 'design_doc') {
      // 設計書ヘッダの元になる front matter が無ければ足す
      if (!hasFrontMatter(content)) {
        content = `${designDocFrontMatter(titleDraft || page.title)}${content}`
      }
    } else if (
      !(await confirmModal().confirm({ title: t('wiki_change_page_type'), text: t('msg_confirm_wiki_type_to_page') }))
    ) {
      return
    }
    setContentDraft(content)
    setEditorBase(content)
    setEditorKey((key) => key + 1)
    setTypeDraft(type)
  }

  const save = async () => {
    setSaving(true)
    try {
      // 編集を始めた時点の更新日時を渡し、その後に他の人が保存していれば競合として止める(下書きは残る)
      await parseAction(
        updateWikiPage({
          id: page.id,
          title: titleDraft,
          content: contentDraft,
          type: typeDraft,
          tagIds: tagIdsDraft,
          expectedUpdatedAt: baseUpdatedAt.toISOString(),
        }),
      )
      notify.success(t('msg_saved'))
      // 表示モードへ戻すのはサーバー値が届いた後。先に戻すと旧本文が一瞬見える
      await onSaved()
      setEditing(false)
    } catch (e) {
      // エラー表示は parseAction 側で済んでいる。編集中の内容を失わせないため編集状態は維持する
      if (!(e instanceof ClientError)) {
        throw e
      }
    } finally {
      setSaving(false)
    }
  }

  const isSubmittable =
    titleDraft.trim().length > 0 && titleDraft.length <= MAX_WIKI_TITLE && contentDraft.length <= MAX_WIKI_CONTENT
  const updatedBy = page.updatedBy?.name ?? page.createdBy?.name
  const isDesignDoc = (isEditing ? typeDraft : page.type) === 'design_doc'

  const editAction = !isEditing && canWrite && (
    <MultiButton
      isIconOnly
      size='sm'
      variant='outline'
      tooltip={t('update')}
      icon={<PencilSquareIcon width={16} />}
      onPress={startEditing}
    />
  )
  const footer = isEditing && (
    <SubmitButtons
      size='sm'
      label={t('save')}
      icon={<CheckIcon width={16} />}
      isPending={isSaving}
      isDisabled={!isSubmittable}
      onPress={save}
      onCancel={() => setEditing(false)}
    />
  )

  const body = !isDesignDoc ? (
    <MarkdownField
      key={editorKey}
      body={page.content}
      isEditing={isEditing}
      // 編集中に変わらない値を渡す(MDXEditor は編集モードのマウント時にこの値を取り込む)
      defaultValue={editorBase}
      onChange={setContentDraft}
      length={contentDraft.length}
      maxLength={MAX_WIKI_CONTENT}
      label={t('content')}
      minRows={6}
      allowImages
      uploadWikiSpaceId={page.spaceId}
      action={editAction}
      footer={footer}
    />
  ) : isEditing ? (
    <DesignDocEditor
      key={editorKey}
      initialValue={editorBase}
      onChange={setContentDraft}
      documentId={page.id}
      length={contentDraft.length}
      maxLength={MAX_WIKI_CONTENT}
      label={t('content')}
      allowImages
      uploadWikiSpaceId={page.spaceId}
      footer={footer}
    />
  ) : (
    <EditorField
      label={t('content')}
      action={editAction && <div className='flex min-h-8 items-center gap-2'>{editAction}</div>}
      isFlat
    >
      <DesignDocView
        className={`border-default-200 overflow-hidden rounded-xl border ${DESIGN_DOC_VIEW_HEIGHT}`}
        markdown={page.content}
        documentId={page.id}
      />
    </EditorField>
  )

  return (
    <>
      <div
        // 設計書は図と見出しを横に並べるため、幅の制限(max-w-4xl)を外す
        data-wide={isDesignDoc ? '' : undefined}
        className='space-y-1'
      >
        {isEditing ? (
          <WikiPageEditHeader
            title={titleDraft}
            onTitleChange={setTitleDraft}
            type={typeDraft}
            onTypeChange={changeType}
            tagIds={tagIdsDraft}
            onTagIdsChange={setTagIdsDraft}
          />
        ) : (
          <>
            <h1 className='text-2xl font-bold wrap-break-word'>{page.title}</h1>
            <WikiTagLinks spaceKey={space.key} tags={page.tags.map(({ tag }) => tag)} />
          </>
        )}
        <p className='text-muted text-xs'>
          {t('wiki_updated_by', { name: updatedBy ?? '-', at: dayformat(page.updatedAt, 'tz-minute', tz) })}
        </p>
      </div>

      <div ref={contentRef} className='py-2'>
        {body}
      </div>
      {!isEditing && !isDesignDoc && <MarkdownToc targetRef={contentRef} />}
    </>
  )
}
