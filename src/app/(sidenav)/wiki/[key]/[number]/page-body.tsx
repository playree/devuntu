'use client'

import { MultiButton, SubmitButtons } from '@/components/general/button'
import { InputField } from '@/components/general/input'
import { useConfirmModal } from '@/components/general/modal'
import { PanelSpinner } from '@/components/general/panel'
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
import { MAX_WIKI_CONTENT, MAX_WIKI_REVISION_MESSAGE, MAX_WIKI_TITLE } from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { FC, useEffect, useRef, useState } from 'react'
import { EDIT_QUERY } from '../page-modals'
import { useWikiSpace } from '../space-context'
import { WikiPageEditHeader } from './page-edit-header'
import {
  usePastPageView,
  useWikiPageRevisions,
  WikiPastRevisionNotice,
  WikiRevisionActions,
  WikiRevisionSelect,
} from './page-revision'
import { GetWikiPageReturnType, updateWikiPage } from './server'

type Page = NonNullable<GetWikiPageReturnType>['page']

/**
 * ページのタイトル・タグ・本文。表示と編集を切り替え、保存したらサーバー値を取り直す。
 * 作成直後(`?edit=1`)は編集から始める。
 * 設計書のページは Markdown Design Doc Viewer で表示し、ソースとプレビューで編集する(幅の制限を外す)。
 * 表示中は更新者・日時から版を選べ、過去の版はその時点の内容で表示する(編集はできず、ロールバックと削除だけ)
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
  const revisions = useWikiPageRevisions(page)
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
  const [messageDraft, setMessageDraft] = useState('')
  // 競合の判定の基準。編集中にページを取り直しても(移動など)、編集を始めた時点の値で比べる
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(page.updatedAt)
  const [isSaving, setSaving] = useState(false)
  // 設計書の画像のアップロード中。終わるまで本文に仮の印があるので、保存と種類の切り替えを止める
  const [isUploading, setUploading] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  // 最新の下書き。種類の切り替えで確認を待つ間に本文が変わっても、承認した時点の本文を引き継ぐ
  const contentDraftRef = useRef(page.content)

  const changeContent = (content: string) => {
    contentDraftRef.current = content
    setContentDraft(content)
  }

  // クエリは消して、再読み込みで編集に戻らないようにする
  useEffect(() => {
    if (hasEditQuery) {
      router.replace(pathname)
    }
  }, [hasEditQuery, pathname, router])

  const startEditing = () => {
    setTitleDraft(page.title)
    changeContent(page.content)
    setTypeDraft(page.type)
    setUploading(false)
    setEditorBase(page.content)
    setEditorKey((key) => key + 1)
    setTagIdsDraft(pageTagIds())
    setMessageDraft('')
    setBaseUpdatedAt(page.updatedAt)
    setEditing(true)
  }

  /** 種類を切り替え、下書きを引き継いでエディタを開き直す */
  const changeType = async (type: WikiPageType) => {
    if (type === typeDraft || isUploading) {
      return
    }
    if (
      type === 'page' &&
      !(await confirmModal().confirm({ title: t('wiki_change_page_type'), text: t('msg_confirm_wiki_type_to_page') }))
    ) {
      return
    }
    let content = contentDraftRef.current
    // 設計書ヘッダの元になる front matter が無ければ足す
    if (type === 'design_doc' && !hasFrontMatter(content)) {
      content = `${designDocFrontMatter(titleDraft.trim() || page.title)}${content}`
    }
    changeContent(content)
    setEditorBase(content)
    setEditorKey((key) => key + 1)
    setTypeDraft(type)
  }

  const save = async () => {
    setSaving(true)
    try {
      // 編集を始めた時点の更新日時を渡し、その後に他の人が保存していれば競合として止める(下書きは残る)
      const result = await parseAction(
        updateWikiPage({
          id: page.id,
          title: titleDraft,
          content: contentDraft,
          type: typeDraft,
          tagIds: tagIdsDraft,
          expectedUpdatedAt: baseUpdatedAt.toISOString(),
          message: messageDraft,
        }),
      )
      // 変更が無ければ版を作らないので、コミットメッセージも残らない
      if (result.result === 'unchanged' && messageDraft.trim()) {
        notify.info(t('msg_wiki_message_not_saved'))
      } else {
        notify.success(t('msg_saved'))
      }
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
    !isUploading &&
    titleDraft.trim().length > 0 &&
    titleDraft.length <= MAX_WIKI_TITLE &&
    contentDraft.length <= MAX_WIKI_CONTENT &&
    messageDraft.length <= MAX_WIKI_REVISION_MESSAGE
  const updatedBy = page.updatedBy?.name ?? page.createdBy?.name
  // 過去の版は表示中だけ(編集はいまの内容から始める)
  const pastView = usePastPageView(isEditing ? undefined : revisions.past)
  const shown = pastView ?? { title: page.title, type: page.type, tags: page.tags.map(({ tag }) => tag) }
  const shownContent = pastView ? revisions.pastContent : page.content
  const isDesignDoc = (isEditing ? typeDraft : shown.type) === 'design_doc'
  const isDesignDocView = isDesignDoc && !isEditing

  const updatedText = t('wiki_updated_by', { name: updatedBy ?? '-', at: dayformat(page.updatedAt, 'tz-minute', tz) })
  const updatedInfo = <p className='text-muted text-xs'>{updatedText}</p>
  const editAction = !isEditing && canWrite && !pastView && (
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
    <div // スマホ幅ではコミットメッセージを1行に取り、ボタンをその下に置く
      className='flex w-full flex-wrap items-center justify-end gap-2'
    >
      <div className='w-full min-w-0 sm:w-auto sm:flex-1'>
        <InputField // 版に残すコミットメッセージ(任意)
          isSmart
          isLabelHidden
          label={t('wiki_revision_message')}
          placeholder={t('wiki_revision_message')}
          value={messageDraft}
          onChange={(e) => setMessageDraft(e.target.value)}
          maxLength={MAX_WIKI_REVISION_MESSAGE}
        />
      </div>
      <SubmitButtons
        size='sm'
        label={t('save')}
        icon={<CheckIcon width={16} />}
        isPending={isSaving}
        isDisabled={!isSubmittable}
        onPress={save}
        onCancel={() => setEditing(false)}
      />
    </div>
  )

  const body =
    shownContent === undefined ? (
      // 過去の版の本文を取得中
      <PanelSpinner />
    ) : !isDesignDoc ? (
      <MarkdownField
        key={editorKey}
        body={shownContent}
        isEditing={isEditing}
        // 編集中に変わらない値を渡す(MDXEditor は編集モードのマウント時にこの値を取り込む)
        defaultValue={editorBase}
        onChange={changeContent}
        length={contentDraft.length}
        maxLength={MAX_WIKI_CONTENT}
        label={t('content')}
        isLabelHidden
        // 表示中はタイトルの横に出している
        info={isEditing ? updatedInfo : undefined}
        minRows={6}
        allowImages
        uploadWikiSpaceId={page.spaceId}
        footer={footer}
      />
    ) : isEditing ? (
      <DesignDocEditor
        key={editorKey}
        initialValue={editorBase}
        onChange={changeContent}
        documentId={page.id}
        length={contentDraft.length}
        maxLength={MAX_WIKI_CONTENT}
        label={t('content')}
        isLabelHidden
        info={updatedInfo}
        allowImages
        uploadWikiSpaceId={page.spaceId}
        onUploadingChange={setUploading}
        footer={footer}
      />
    ) : (
      <DesignDocView // 中でスクロールするので、画面の残りを埋める枠(下の div)いっぱいに広げる
        className='border-default-200 absolute inset-0 overflow-hidden rounded-xl border'
        markdown={shownContent}
        // 版を切り替えたら先頭から表示し直す
        documentId={pastView ? `${page.id}:${pastView.id}` : page.id}
      />
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
            isTypeDisabled={isUploading}
            tagIds={tagIdsDraft}
            onTagIdsChange={setTagIdsDraft}
          />
        ) : (
          <div className='flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1'>
            <h1 className='min-w-0 text-2xl font-bold wrap-break-word'>{shown.title}</h1>
            <WikiTagLinks spaceKey={space.key} tags={shown.tags} />
            <div // 編集・戻す・削除は版の選択のすぐ右に置き、版に対する操作だと分かるようにする(折り返しても離さない)
              className='flex items-center gap-2'
            >
              <WikiRevisionSelect revisions={revisions} updatedText={updatedText} />
              {editAction}
              {canWrite && !isEditing && <WikiRevisionActions revisions={revisions} onRestored={onSaved} />}
            </div>
          </div>
        )}
      </div>
      {!isEditing && <WikiPastRevisionNotice revisions={revisions} />}

      <div
        ref={contentRef}
        // 設計書の表示は、ページ側(data-fill-screen を見て画面 1 枚分の高さを持つ)の残りを埋める
        data-fill-screen={isDesignDocView ? '' : undefined}
        className={isDesignDocView ? 'relative min-h-96 flex-1' : 'py-2'}
      >
        {body}
      </div>
      {!isEditing && !isDesignDoc && <MarkdownToc targetRef={contentRef} />}
    </>
  )
}
