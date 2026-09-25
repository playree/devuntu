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
}> = ({ label, isRequired, length, maxLength, errorMessage, action, isFlat, isBordered, children }) => {
  const { isCompact, hasErrorArea } = useSmart()
  return (
    <TextField isInvalid={!!errorMessage} className='mb-0.5'>
      <div // action にはボタンが入るため、そのときだけ中央揃えにしてラベルと高さを合わせる
        className={cn('flex justify-between', action ? 'items-center' : 'items-baseline')}
      >
        <FieldLabel isCompact={isCompact} isRequired={isRequired}>
          {label}
        </FieldLabel>
        <div className='flex items-center gap-2'>
          {length !== undefined && maxLength !== undefined && (
            <span className={cn('font-mono text-xs', length > maxLength ? 'text-danger' : 'text-muted')}>
              {length} / {maxLength}
            </span>
          )}
          {action}
        </div>
      </div>
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
