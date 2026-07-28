'use client'

import { getFieldConstraints } from '@/lib/schema-util'
import { useLocale } from '@/locale/client'
import { ErrorMessage, Label, Skeleton, TextField } from '@heroui/react'
import dynamic from 'next/dynamic'
import { FC, memo, ReactNode, useCallback, useState } from 'react'
import { Control, FieldPath, FieldValues, useController } from 'react-hook-form'
import { z } from 'zod'

// MDXEditor はブラウザ専用なので SSR から外す(lexical / codemirror も別チャンクへ分離される)
const MdxEditorCore = dynamic(() => import('./mdx-editor-core'), {
  ssr: false,
  loading: () => <Skeleton className='min-h-40 w-full rounded-xl' />,
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
}>(function MdxEditorHost({ initialMarkdown, onChange, onBlur }) {
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
    <div ref={anchorRef} className='min-h-40'>
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
}> = ({ label, isRequired, length, maxLength, errorMessage, children }) => (
  <TextField isInvalid={!!errorMessage}>
    <div className='flex items-baseline justify-between'>
      <Label>
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
}> = ({ defaultValue, onChange, length, label, maxLength, errorMessage }) => {
  const { t } = useLocale()
  // 初回マウント時の値を固定する(MDXEditor は markdown prop の変更を取り込まない)
  const [initialMarkdown] = useState(defaultValue)

  return (
    <EditorField label={label ?? t('content')} length={length} maxLength={maxLength} errorMessage={errorMessage}>
      <MdxEditorHost initialMarkdown={initialMarkdown} onChange={onChange} />
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
}: {
  control: Control<TFieldValues>
  name: TName
  constraintSchema?: z.ZodObject
  label?: string
  errorMessage?: string
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
      <MdxEditorHost initialMarkdown={initialMarkdown} onChange={field.onChange} onBlur={field.onBlur} />
    </EditorField>
  )
}
