import { useLeaveGuard } from '@/components/general/leave-guard'
import { type ConfirmParam, useConfirmModal, useModalState } from '@/components/general/modal'
import { useSaveShortcut } from '@/components/general/use-save-shortcut'
import { notify } from '@/components/notify'
import type { WikiPageType } from '@/generated/prisma/enums'
import { parseAction } from '@/lib/action/action-client'
import { ClientError } from '@/lib/error'
import { designDocFrontMatter, hasFrontMatter } from '@/lib/wiki/wiki-front-matter'
import {
  EDIT_QUERY,
  isWikiPageChanged,
  MAX_WIKI_CONTENT,
  MAX_WIKI_REVISION_MESSAGE,
  MAX_WIKI_TITLE,
  WIKI_PAGE_CONFLICT,
  type WikiPageFields,
} from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useWikiSpace } from '../space-context'
import type { WikiPageConflictTarget } from './page-conflict-modal'
import { getWikiPage, type GetWikiPageReturnType, updateWikiPage } from './server'

type Page = NonNullable<GetWikiPageReturnType>['page']

/** 編集の下書きと保存。サーバーからページを取り直しても、編集中の値と競合の判定基準は保持する */
export const useWikiPageEditor = (page: Page, canWrite: boolean, onSaved: () => Promise<void>) => {
  const { t } = useLocale()
  const { space } = useWikiSpace()
  const { confirmModal } = useConfirmModal()
  const conflictState = useModalState<WikiPageConflictTarget>()
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
  // 最新の下書き。種類の切り替えで確認を待つ間に本文が変わっても、承認した時点の本文を引き継ぐ
  const contentDraftRef = useRef(page.content)
  // 編集を始めた時点の値。下書きに変更があるかをこれと比べる(作成直後の編集は、マウント時の値から始まる)
  const [draftBase, setDraftBase] = useState<WikiPageFields>(() => ({
    title: page.title,
    content: page.content,
    type: page.type,
    tagIds: pageTagIds(),
  }))
  // 確認のモーダルを待っている間。Ctrl/Cmd+S で裏から保存しない
  const isAskingRef = useRef(false)

  const ask = useCallback(
    async (param: ConfirmParam) => {
      isAskingRef.current = true
      try {
        return await confirmModal().confirm(param)
      } finally {
        isAskingRef.current = false
      }
    },
    [confirmModal],
  )
  const confirmDiscard = useCallback(
    () => ask({ title: t('wiki_discard_draft'), text: t('msg_confirm_wiki_discard_draft') }),
    [ask, t],
  )

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
    setDraftBase({ title: page.title, content: page.content, type: page.type, tagIds: pageTagIds() })
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
      !(await ask({ title: t('wiki_change_page_type'), text: t('msg_confirm_wiki_type_to_page') }))
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

  /** 競合したら最新を取り直し、選択肢のモーダルを出す(取れなくても、最新の確認と下書きのコピーはできる) */
  const openConflict = async () => {
    const latest = await parseAction(getWikiPage({ key: space.key, number: page.number }), { handled: 'all' }).catch(
      () => undefined,
    )
    conflictState.open({
      latest: latest && {
        updatedAt: latest.page.updatedAt,
        updatedByName: latest.page.updatedBy?.name ?? latest.page.createdBy?.name,
      },
    })
  }

  /**
   * 編集を始めた時点の更新日時を渡し、その後に他の人が保存していれば競合として止める(下書きは残る)。
   * 上書き保存では、競合の後に取り直した最新の更新日時を渡す
   */
  const save = async (expectedUpdatedAt = baseUpdatedAt) => {
    setSaving(true)
    try {
      const result = await parseAction(
        updateWikiPage({
          id: page.id,
          title: titleDraft,
          content: contentDraft,
          type: typeDraft,
          tagIds: tagIdsDraft,
          expectedUpdatedAt: expectedUpdatedAt.toISOString(),
          message: messageDraft,
        }),
        { handled: [WIKI_PAGE_CONFLICT] },
      )
      // 変更が無ければ版を作らないので、コミットメッセージも残らない
      if (result.result === 'unchanged' && messageDraft.trim()) {
        notify.info(t('msg_wiki_message_not_saved'))
      } else {
        notify.success(t('msg_saved'))
      }
      // 表示モードへ戻すのはサーバー値が届いた後。先に戻すと旧本文が一瞬見える
      await onSaved()
      conflictState.close()
      setEditing(false)
    } catch (e) {
      // 競合以外のエラー表示は parseAction 側で済んでいる。編集中の内容を失わせないため編集状態は維持する
      if (!(e instanceof ClientError)) {
        throw e
      }
      if (e.errorType === WIKI_PAGE_CONFLICT) {
        await openConflict()
      }
    } finally {
      setSaving(false)
    }
  }

  const overwrite = async (expectedUpdatedAt: Date) => {
    if (!isSubmittable) {
      return
    }
    if (await ask({ title: t('wiki_conflict_overwrite'), text: t('msg_confirm_wiki_overwrite') })) {
      await save(expectedUpdatedAt)
    }
  }

  const cancelEditing = async () => {
    if (!isDirty || (await confirmDiscard())) {
      setEditing(false)
    }
  }

  const isSubmittable =
    !isUploading &&
    titleDraft.trim().length > 0 &&
    titleDraft.length <= MAX_WIKI_TITLE &&
    contentDraft.length <= MAX_WIKI_CONTENT &&
    messageDraft.length <= MAX_WIKI_REVISION_MESSAGE
  const isDirty =
    isEditing &&
    isWikiPageChanged(draftBase, { title: titleDraft, content: contentDraft, type: typeDraft, tagIds: tagIdsDraft })

  // リンク・メニュー・子ページの作成などで画面を移る前と、タブを閉じる前に確認する
  useLeaveGuard({ isActive: isDirty, confirmLeave: confirmDiscard })
  useSaveShortcut({
    isActive: isEditing,
    onSave: () => {
      if (isSubmittable && !isSaving && !conflictState.isOpen && !isAskingRef.current) {
        void save()
      }
    },
  })

  return {
    isEditing,
    isSaving,
    isSubmittable,
    isUploading,
    setUploading,
    titleDraft,
    setTitleDraft,
    typeDraft,
    changeType,
    tagIdsDraft,
    setTagIdsDraft,
    contentDraft,
    changeContent,
    editorBase,
    editorKey,
    messageDraft,
    setMessageDraft,
    startEditing,
    cancelEditing,
    save,
    conflictState,
    overwrite,
  }
}

export type WikiPageEditor = ReturnType<typeof useWikiPageEditor>
