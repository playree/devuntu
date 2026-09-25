'use client'

import { EditorField } from '@/components/general/editor-field'
import { useLocale } from '@/locale/client'
import { Skeleton } from '@heroui/react'
import dynamic from 'next/dynamic'
import { FC, ReactNode, useState } from 'react'
import { Control, FieldPath, FieldValues, useController } from 'react-hook-form'
import type { EditorIssue } from './yaml-lint'

/** 編集面の既定の最小行数 */
const DEFAULT_MIN_ROWS = 12

const MIN_HEIGHT = `calc(${DEFAULT_MIN_ROWS} * 1.4rem)`

// CodeMirror はブラウザ専用なので SSR から外す(本体が別チャンクへ分離される)
const YamlEditorCore = dynamic(() => import('./yaml-editor-core'), {
  ssr: false,
  loading: () => <Skeleton className='w-full rounded-xl' style={{ minHeight: MIN_HEIGHT }} />,
})

/**
 * YAML エディタ(非制御)。`defaultValue` は初回マウント時の値としてのみ使われる。
 * 外から内容を入れ替えたい場合は `key` を変えて再マウントする。
 */
export const YamlInput: FC<{
  defaultValue: string
  onChange: (value: string) => void
  label?: string
  errorMessage?: string
  placeholder?: string
  minRows?: number
  action?: ReactNode
  /** 内容から指摘を作る。渡すと該当箇所へ印が付く */
  lint?: (value: string) => EditorIssue[]
}> = ({ defaultValue, onChange, label, errorMessage, placeholder, minRows, action, lint }) => {
  const { t } = useLocale()
  // 初回マウント時の値を固定する(CodeMirror は doc の差し替えを prop では取り込まない)
  const [initialValue] = useState(defaultValue)

  return (
    <EditorField label={label ?? t('command_def_yaml')} errorMessage={errorMessage} action={action} isBordered>
      <YamlEditorCore
        initialValue={initialValue}
        onChange={onChange}
        placeholder={placeholder}
        minRows={minRows ?? DEFAULT_MIN_ROWS}
        lint={lint}
      />
    </EditorField>
  )
}

/** YAML エディタ(react-hook-form 対応) */
export const YamlCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  label,
  errorMessage,
  placeholder,
  minRows,
  action,
  lint,
}: {
  control: Control<TFieldValues>
  name: TName
  label?: string
  errorMessage?: string
  placeholder?: string
  minRows?: number
  action?: ReactNode
  /** 内容から指摘を作る。渡すと該当箇所へ印が付く */
  lint?: (value: string) => EditorIssue[]
}) => {
  const { t } = useLocale()
  const { field } = useController({ control, name })
  const current = typeof field.value === 'string' ? field.value : ''
  const [initialValue] = useState(current)

  return (
    <EditorField label={label ?? t('command_def_yaml')} errorMessage={errorMessage} action={action} isBordered>
      <YamlEditorCore // useController の onChange / onBlur は安定参照なのでそのまま渡せる
        initialValue={initialValue}
        onChange={field.onChange}
        onBlur={field.onBlur}
        placeholder={placeholder}
        minRows={minRows ?? DEFAULT_MIN_ROWS}
        lint={lint}
      />
    </EditorField>
  )
}
