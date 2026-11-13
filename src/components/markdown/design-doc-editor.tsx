'use client'

import type { CodeEditorHandle } from '@/components/code/code-editor-core'
import { EditorField } from '@/components/general/editor-field'
import { TabsBox } from '@/components/general/tabs'
import { notify } from '@/components/notify'
import { uploadImage } from '@/lib/storage/upload'
import { useDebounced } from '@/lib/use-debounced'
import { useMediaQuery } from '@/lib/use-media-query'
import { useLocale } from '@/locale/client'
import { cn, Skeleton } from '@heroui/react'
import type { DesignDocViewerHandle } from 'markdown-design-doc-viewer-embed/react'
import dynamic from 'next/dynamic'
import { FC, ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { DesignDocView } from './design-doc-view'

const MarkdownEditorCore = dynamic(() => import('@/components/code/markdown-editor-core'), {
  ssr: false,
  loading: () => <Skeleton className='h-full w-full rounded-xl' />,
})

/** プレビューを更新するまでの待ち(打鍵のたびに図を描き直さない) */
const PREVIEW_DELAY_MS = 300

/** 横並びにする幅(Tailwind の lg) */
const SPLIT_QUERY = '(min-width: 64rem)'

/** 編集面とプレビューの高さ。画面の残りを使い、低い画面でも最低限は確保する */
const PANE_HEIGHT = 'h-[calc(100dvh-16rem)] min-h-96'

/** 画像の代替テキスト。拡張子を除き、リンクの記法を壊す文字は外す */
const altOf = (file: File) => file.name.replace(/\.[^.]*$/, '').replace(/[[\]\\]/g, '')

/**
 * 設計書(Markdown Design Doc Viewer の形式)の編集。ソースを CodeMirror で書き、横にビューアのプレビューを並べる。
 * 本文は手を加えずにそのまま扱う(front matter や HTML コメントを保つ)。
 *
 * - lg 以上は左にソース、右にプレビュー。プレビューのダブルクリックでソースの該当行へ移り、ソースのカーソル行にプレビューで印を付ける
 * - lg 未満はタブで切り替える
 * - 画像の貼り付け・ドロップは、その位置へ仮の印(HTML コメント)を置いてアップロードし、終わったら印を `![名前](URL)` に置き換える。
 *   待つ間に選択や本文が変わっても、置き換えるのは印だけ。アップロード中は `onUploadingChange` で知らせる
 *
 * 非制御。`initialValue` は初回マウント時の値としてのみ使う
 */
export const DesignDocEditor: FC<{
  initialValue: string
  onChange: (markdown: string) => void
  /** プレビューの文書の識別子(ページの id) */
  documentId: string
  /** 文字数カウンタに使う現在値 */
  length: number
  maxLength?: number
  label?: string
  /** ラベルを読み上げ名だけにする({@link EditorField} 参照) */
  isLabelHidden?: boolean
  /** ラベル行の左側に置く補足({@link EditorField} 参照) */
  info?: ReactNode
  /** 画像の挿入を許可する。添付先のスペースと一緒に渡す */
  allowImages?: boolean
  /** 挿入した画像の添付先 Wiki スペース。配信時にこのスペースの閲覧判定が掛かる */
  uploadWikiSpaceId?: string | null
  /** 画像のアップロード中かどうかが変わったとき。終わるまでは本文に仮の印が残るので、保存を止めるのに使う */
  onUploadingChange?: (isUploading: boolean) => void
  /** ラベル行の右端に置く操作 */
  action?: ReactNode
  /** 本文の下に右寄せで置く操作(キャンセル / 保存など) */
  footer?: ReactNode
}> = ({
  initialValue,
  onChange,
  documentId,
  length,
  maxLength,
  label,
  isLabelHidden,
  info,
  allowImages,
  uploadWikiSpaceId,
  onUploadingChange,
  action,
  footer,
}) => {
  const { t } = useLocale()
  const isSplit = useMediaQuery(SPLIT_QUERY)
  const [markdown, setMarkdown] = useState(initialValue)
  const preview = useDebounced(markdown, PREVIEW_DELAY_MS)
  const [tab, setTab] = useState('edit')
  const editorRef = useRef<CodeEditorHandle>(null)
  const viewerRef = useRef<DesignDocViewerHandle>(null)
  // アップロード中の件数と、仮の印を一意にする連番。isActive はこのエディタがマウント中か
  const uploads = useRef({ pending: 0, seq: 0, isActive: false })
  useEffect(() => {
    const state = uploads.current
    state.isActive = true
    return () => {
      state.isActive = false
    }
  }, [])

  const change = useCallback(
    (value: string) => {
      setMarkdown(value)
      onChange(value)
    },
    [onChange],
  )

  const revealLine = useCallback((line: number) => {
    setTab('edit')
    // タブから戻したときはエディタが見えてから移す
    requestAnimationFrame(() => editorRef.current?.revealLine(line))
  }, [])

  const markLine = useCallback((line: number) => viewerRef.current?.markLine(line), [])

  const insertImages = useCallback(
    (files: File[]) => {
      const images = files.filter((file) => file.type.startsWith('image/'))
      const editor = editorRef.current
      if (!allowImages || images.length === 0 || !editor) {
        return false
      }
      const state = uploads.current
      const items = images.map((file) => ({ file, mark: `<!-- uploading ${Date.now()}-${++state.seq} -->` }))
      editor.insertText(items.map(({ mark }) => `${mark}\n`).join(''))
      state.pending += items.length
      onUploadingChange?.(true)
      void (async () => {
        for (const { file, mark } of items) {
          try {
            const url = await uploadImage(file, { wikiSpaceId: uploadWikiSpaceId })
            // 印を消されていたら差し込まない。幅の変化でエディタを作り直していても、本文に残った印を置き換える
            editorRef.current?.replaceText(mark, `![${altOf(file)}](${url})`)
          } catch (e) {
            if (!editorRef.current?.replaceText(`${mark}\n`, '')) {
              editorRef.current?.replaceText(mark, '')
            }
            notify.error(t('msg_image_upload_failed'), { description: e instanceof Error ? e.message : undefined })
          } finally {
            state.pending--
            // 閉じた後(キャンセルして編集し直した後など)に終わったものは、次の編集のアップロード状態を変えない
            if (state.isActive) {
              onUploadingChange?.(state.pending > 0)
            }
          }
        }
      })()
      return true
    },
    [allowImages, uploadWikiSpaceId, onUploadingChange, t],
  )

  const editor = (
    <div
      className={cn('border-default-200 focus-within:border-primary overflow-hidden rounded-xl border', PANE_HEIGHT)}
    >
      <MarkdownEditorCore
        // 初回マウント時だけ読まれる。幅の変化で横並び ⇄ タブを切り替えて作り直すときも、編集後の値から始める
        initialValue={markdown}
        onChange={change}
        aria-label={label ?? t('content')}
        onCursorLine={isSplit ? markLine : undefined}
        onFiles={insertImages}
        isFill
        editorRef={editorRef}
      />
    </div>
  )
  const viewer = (
    <DesignDocView
      className={cn('border-default-200 overflow-hidden rounded-xl border', PANE_HEIGHT)}
      markdown={preview}
      documentId={documentId}
      onRevealLine={revealLine}
      viewerRef={viewerRef}
    />
  )

  return (
    <EditorField
      label={label ?? t('content')}
      isLabelHidden={isLabelHidden}
      info={info}
      length={length}
      maxLength={maxLength}
      action={action && <div className='flex min-h-8 items-center gap-2'>{action}</div>}
      isFlat
    >
      {isSplit ? (
        <div className='grid grid-cols-2 gap-2'>
          {editor}
          {viewer}
        </div>
      ) : (
        <TabsBox
          aria-label={t('wiki_design_doc_editor')}
          variant='secondary'
          selectedKey={tab}
          onSelectionChange={setTab}
          forceMount
          panelClassName='pt-2'
          items={[
            { id: 'edit', label: t('wiki_design_doc_source'), content: editor },
            // 隠れたパネルでは mermaid が文字の幅を測れず図が崩れるので、プレビューは選んだときだけ描く
            { id: 'preview', label: t('preview'), content: tab === 'preview' && viewer },
          ]}
        />
      )}
      {footer && <div className='mt-2 flex justify-end gap-2'>{footer}</div>}
    </EditorField>
  )
}
