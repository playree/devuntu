'use client'

import { cn, TextField } from '@heroui/react'
import { FC, ReactNode } from 'react'
import { FieldError, FieldLabel } from './field'
import { useSmart } from './smart'

/**
 * エディタ(Markdown / YAML など)用のラベル・文字数・エラーの体裁。TagInput と同じ TextField ベース。
 * エディタ本体は children に渡す。
 */
export const EditorField: FC<{
  label: string
  /** ラベルを読み上げ名だけにする。info も文字数カウンタも action も無ければラベル行ごと出さない */
  isLabelHidden?: boolean
  /** ラベル行の左側(ラベルの後ろ)に置く補足 */
  info?: ReactNode
  isRequired?: boolean
  /** maxLength と一緒に渡すと文字数カウンタを出す */
  length?: number
  maxLength?: number
  errorMessage?: string
  /** ラベル行の右端に置く操作(文字数カウンタの後ろ) */
  action?: ReactNode
  /** 枠なし表示。エラー用の高さを常時確保しない */
  isFlat?: boolean
  /** エディタの周りに枠線を付ける(枠を自前で持たないエディタ向け) */
  isBordered?: boolean
  children: ReactNode
}> = ({
  label,
  isLabelHidden,
  info,
  isRequired,
  length,
  maxLength,
  errorMessage,
  action,
  isFlat,
  isBordered,
  children,
}) => {
  const { isCompact, hasErrorArea } = useSmart()
  const hasCounter = length !== undefined && maxLength !== undefined
  const fieldLabel = (
    <FieldLabel isCompact={isCompact} isHidden={isLabelHidden} isRequired={isRequired}>
      {label}
    </FieldLabel>
  )
  return (
    <TextField isInvalid={!!errorMessage} className='mb-0.5'>
      {isLabelHidden && !info && !hasCounter && !action ? (
        fieldLabel
      ) : (
        <div // action にはボタンが入るため、そのときだけ中央揃えにしてラベルと高さを合わせる
          className={cn('flex justify-between', action ? 'items-center' : 'items-baseline')}
        >
          <div className='flex min-w-0 items-baseline gap-2'>
            {fieldLabel}
            {info}
          </div>
          <div className='ml-auto flex items-center gap-2'>
            {hasCounter && (
              <span className={cn('font-mono text-xs', length > maxLength ? 'text-danger' : 'text-muted')}>
                {length} / {maxLength}
              </span>
            )}
            {action}
          </div>
        </div>
      )}
      {isBordered ? (
        <div className='border-default-200 focus-within:border-primary overflow-hidden rounded-xl border'>
          {children}
        </div>
      ) : (
        children
      )}
      <FieldError hasErrorArea={!isFlat && hasErrorArea}>{errorMessage}</FieldError>
    </TextField>
  )
}
