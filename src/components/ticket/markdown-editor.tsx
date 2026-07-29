'use client'

import { getFieldConstraints } from '@/lib/schema-util'
import { useLocale } from '@/locale/client'
import { ErrorMessage, Label, Skeleton, TextField } from '@heroui/react'
import dynamic from 'next/dynamic'
import { CSSProperties, FC, memo, ReactNode, useCallback, useState } from 'react'
import { Control, FieldPath, FieldValues, useController } from 'react-hook-form'
import { z } from 'zod'
import { useIsSmart } from '../general/smart'

/**
 * 編集面の既定の最小行数。
 *
 * MDXEditor には `rows` / `minRows` 相当の prop が無いため、行数は CSS 変数
 * `--mdx-min-rows` としてラッパーに置き、globals.css 側で min-height に換算する。
 * rich-text(contenteditable)と source(CodeMirror)の両方に継承で届く。
 */
const DEFAULT_MIN_ROWS = 6

/** ローディング Skeleton も同じ変数で高さを合わせ、マウント時のガタつきを防ぐ */
const MIN_HEIGHT = 'calc(var(--mdx-min-rows, 6) * 1.5rem)'

// MDXEditor はブラウザ専用なので SSR から外す(lexical / codemirror も別チャンクへ分離される)
const MdxEditorCore = dynamic(() => import('./mdx-editor-core'), {
  ssr: false,
  loading: () => <Skeleton className='w-full rounded-xl' style={{ minHeight: MIN_HEIGHT }} />,
})

/**
 * MDXEditor のマウント位置を確定させるラッパー。
 *
 * MDXEditor は Radix のポップアップを `overlayContainer`(既定は document.body)配下へ出すが、
 * HeroUI Modal は react-aria の focus containment を持つため body だとフォーカスを引き戻され、
 * リンク・テーブル・言語選択の UI が使えない。Modal.Dialog を探して描画先に指定する。
 * Modal.Body ではなく Dialog 直下にするのは、Body が `overflow-y: auto` でクリップするため。
 *
 * props をすべて安定参照にして memo するため、入力のたびに MDXEditor 全体
 * (ツールバー含む)が再レンダリングされない。
 */
const MdxEditorHost = memo<{
  /** 初期 Markdown。マウント後の変更は反映されないので安定値を渡す */
  initialMarkdown: string
  onChange: (markdown: string) => void
  onBlur?: () => void
  /** 編集面の最小行数 */
  minRows?: number
}>(function MdxEditorHost({ initialMarkdown, onChange, onBlur, minRows = DEFAULT_MIN_ROWS }) {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [isReady, setReady] = useState(false)

  const anchorRef = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      // モーダル外(コメント欄など)では null になり、MDXEditor 既定の document.body が使われる
      setContainer(el.closest<HTMLElement>('[data-slot="modal-dialog"]'))
      setReady(true)
    }
  }, [])

  return (
    // 最小行数は globals.css の --mdx-min-rows 経由で編集面(rich-text / source)に効かせる
    <div ref={anchorRef} style={{ '--mdx-min-rows': minRows } as CSSProperties}>
      {isReady && (
        <MdxEditorCore markdown={initialMarkdown} onChange={onChange} onBlur={onBlur} overlayContainer={container} />
      )}
    </div>
  )
})

/** ラベル・文字数・エラーの体裁(TagInput と同じ TextField ベース) */
const EditorField: FC<{
  label: string
  isRequired?: boolean
  length: number
  maxLength?: number
  errorMessage?: string
  children: ReactNode
}> = ({ label, isRequired, length, maxLength, errorMessage, children }) => {
  const isSmart = useIsSmart()
  return (
    <TextField isInvalid={!!errorMessage}>
      <div className='flex items-baseline justify-between'>
        <Label className={isSmart ? 'text-xs font-light' : ''}>
          {label}
          {isRequired ? '*' : ''}
        </Label>
        {maxLength !== undefined && (
          <span className={`font-mono text-xs ${length > maxLength ? 'text-danger' : 'text-gray-500'}`}>
            {length} / {maxLength}
          </span>
        )}
      </div>
      {children}
      <ErrorMessage className='min-h-4'>{errorMessage}</ErrorMessage>
    </TextField>
  )
}

/**
 * Markdown エディタ(非制御)。`defaultValue` は初回マウント時の値としてのみ使われる。
 * 外から内容をリセットしたい場合は `key` を変えて再マウントする。
 */
export const MarkdownInput: FC<{
  defaultValue: string
  onChange: (markdown: string) => void
  /** 文字数カウンタに使う現在値 */
  length: number
  label?: string
  maxLength?: number
  errorMessage?: string
  /** 編集面の最小行数(既定 {@link DEFAULT_MIN_ROWS}) */
  minRows?: number
}> = ({ defaultValue, onChange, length, label, maxLength, errorMessage, minRows }) => {
  const { t } = useLocale()
  // 初回マウント時の値を固定する(MDXEditor は markdown prop の変更を取り込まない)
  const [initialMarkdown] = useState(defaultValue)

  return (
    <EditorField label={label ?? t('content')} length={length} maxLength={maxLength} errorMessage={errorMessage}>
      <MdxEditorHost initialMarkdown={initialMarkdown} onChange={onChange} minRows={minRows} />
    </EditorField>
  )
}

/**
 * Markdown エディタ(react-hook-form 対応)。
 * `constraintSchema` を渡すと必須マークと文字数上限をスキーマから反映する。
 */
export const MarkdownEditor = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  constraintSchema,
  label,
  errorMessage,
  minRows,
}: {
  control: Control<TFieldValues>
  name: TName
  constraintSchema?: z.ZodObject
  label?: string
  errorMessage?: string
  /** 編集面の最小行数(既定 {@link DEFAULT_MIN_ROWS}) */
  minRows?: number
}) => {
  const { t } = useLocale()
  const { field } = useController({ control, name })
  const { isRequired, maxLength } = constraintSchema ? getFieldConstraints(constraintSchema, name) : {}

  const current = typeof field.value === 'string' ? field.value : ''
  // 初回マウント時の値を固定する(MDXEditor は markdown prop の変更を取り込まない)
  const [initialMarkdown] = useState(current)

  return (
    <EditorField
      label={label ?? t('content')}
      isRequired={isRequired}
      length={current.length}
      maxLength={maxLength}
      errorMessage={errorMessage}
    >
      {/* useController の onChange / onBlur は useCallback 済みで安定参照のためそのまま渡せる */}
      <MdxEditorHost
        initialMarkdown={initialMarkdown}
        onChange={field.onChange}
        onBlur={field.onBlur}
        minRows={minRows}
      />
    </EditorField>
  )
}
