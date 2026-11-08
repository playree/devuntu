'use client'

import { MultiButton, SubmitButtons } from '@/components/general/button'
import { InputField } from '@/components/general/input'
import { CheckIcon, PencilSquareIcon } from '@/components/icon'
import { MarkdownField } from '@/components/markdown/markdown-editor'
import { MarkdownToc } from '@/components/markdown/markdown-toc'
import { notify } from '@/components/notify'
import { TagIdSelectField } from '@/components/ticket/tag-id-select'
import { WikiTagLinks } from '@/components/wiki-tag'
import { parseAction } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { ClientError } from '@/lib/error'
import { MAX_WIKI_CONTENT, MAX_WIKI_TITLE } from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { FC, useEffect, useRef, useState } from 'react'
import { EDIT_QUERY } from '../page-modals'
import { createWikiTag } from '../server'
import { useWikiSpace } from '../space-context'
import { GetWikiPageReturnType, updateWikiPage } from './server'

type Page = NonNullable<GetWikiPageReturnType>['page']

/**
 * ページのタイトル・タグ・本文。表示と編集を切り替え、保存したらサーバー値を取り直す。
 * 作成直後(`?edit=1`)は編集から始める
 */
export const WikiPageBody: FC<{ page: Page; canWrite: boolean; onSaved: () => Promise<void> }> = ({
  page,
  canWrite,
  onSaved,
}) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const { space, tags: spaceTags } = useWikiSpace()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const hasEditQuery = searchParams.get(EDIT_QUERY) === '1'
  // 作成直後は本文の編集から始める(ページごとに作り直されるので、初期値で決めてよい)
  const [isEditing, setEditing] = useState(() => canWrite && hasEditQuery)
  const [titleDraft, setTitleDraft] = useState(page.title)
  const [contentDraft, setContentDraft] = useState(page.content)
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
    setTagIdsDraft(pageTagIds())
    setBaseUpdatedAt(page.updatedAt)
    setEditing(true)
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

  return (
    <>
      <div className='space-y-1'>
        {isEditing ? (
          <InputField
            label={t('wiki_page_title')}
            value={titleDraft}
            maxLength={MAX_WIKI_TITLE}
            onChange={(e) => setTitleDraft(e.target.value)}
            errorMessage={titleDraft.trim() === '' ? t('@invalid_wiki_title') : undefined}
          />
        ) : (
          <h1 className='text-2xl font-bold wrap-break-word'>{page.title}</h1>
        )}
        {isEditing ? (
          <TagIdSelectField
            options={spaceTags}
            value={tagIdsDraft}
            onChange={setTagIdsDraft}
            onCreate={async (name) => parseAction(createWikiTag({ spaceId: space.id, name }))}
          />
        ) : (
          <WikiTagLinks spaceKey={space.key} tags={page.tags.map(({ tag }) => tag)} />
        )}
        <p className='text-muted text-xs'>
          {t('wiki_updated_by', { name: updatedBy ?? '-', at: dayformat(page.updatedAt, 'tz-minute', tz) })}
        </p>
      </div>

      <div ref={contentRef} className='py-2'>
        <MarkdownField
          body={page.content}
          isEditing={isEditing}
          // 編集中に変わらない値を渡す(MDXEditor は編集モードのマウント時にこの値を取り込む)
          defaultValue={page.content}
          onChange={setContentDraft}
          length={contentDraft.length}
          maxLength={MAX_WIKI_CONTENT}
          label={t('content')}
          minRows={6}
          allowImages
          uploadWikiSpaceId={page.spaceId}
          action={
            !isEditing &&
            canWrite && (
              <MultiButton
                isIconOnly
                size='sm'
                variant='outline'
                tooltip={t('update')}
                icon={<PencilSquareIcon width={16} />}
                onPress={startEditing}
              />
            )
          }
          footer={
            isEditing && (
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
          }
        />
      </div>
      {!isEditing && <MarkdownToc targetRef={contentRef} />}
    </>
  )
}
