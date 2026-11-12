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
import { FC, ReactNode, useCallback, useRef, useState } from 'react'
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
 * - 画像の貼り付け・ドロップはアップロードして `![名前](URL)` を差し込む
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
  /** 画像の挿入を許可する。添付先のスペースと一緒に渡す */
  allowImages?: boolean
  /** 挿入した画像の添付先 Wiki スペース。配信時にこのスペースの閲覧判定が掛かる */
  uploadWikiSpaceId?: string | null
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
  allowImages,
  uploadWikiSpaceId,
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
      if (!allowImages || images.length === 0) {
        return false
      }
      void (async () => {
        for (const file of images) {
          try {
            const url = await uploadImage(file, { wikiSpaceId: uploadWikiSpaceId })
            editorRef.current?.insertText(`![${altOf(file)}](${url})\n`)
          } catch (e) {
            notify.error(t('msg_image_upload_failed'), { description: e instanceof Error ? e.message : undefined })
          }
        }
      })()
      return true
    },
    [allowImages, uploadWikiSpaceId, t],
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
