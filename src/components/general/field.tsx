'use client'

import { cn, ErrorMessage, Label } from '@heroui/react'
import { FC, MouseEvent, PointerEvent, ReactNode } from 'react'
import { XCircleIcon } from './icons'
import { useGeneralUiText } from './ui-text'

/** フォーム部品が共通で受け取る props */
export type FieldBaseProps = {
  label?: string
  /** ラベルを読み上げ用にだけ残す(見出しを呼び出し側で出す場合) */
  isLabelHidden?: boolean
  isRequired?: boolean
  isDisabled?: boolean
  isReadOnly?: boolean
  errorMessage?: string
  isSmart?: boolean
  isSmartForm?: boolean
}

/** フォーム部品のラベル。isCompact で他のコンパクト表示と同じ体裁に揃える */
export const FieldLabel: FC<{
  isCompact?: boolean
  isHidden?: boolean
  isRequired?: boolean
  className?: string
  children: ReactNode
}> = ({ isCompact, isHidden, isRequired, className, children }) => (
  <Label className={cn(isCompact && 'text-xs font-light', isHidden && 'sr-only', className)} isRequired={isRequired}>
    {children}
  </Label>
)

/** フォーム部品のエラーメッセージ。hasErrorArea ではエラーが無くても1行分の高さを確保し、出たときに下が動かないようにする */
export const FieldError: FC<{ hasErrorArea?: boolean; className?: string; children?: ReactNode }> = ({
  hasErrorArea,
  className,
  children,
}) => <ErrorMessage className={cn(hasErrorArea && 'min-h-4', className)}>{children}</ErrorMessage>

/**
 * Select などのトリガーに重ねるクリアボタン。
 *
 * トリガーは内部が button なので、その中に置く場合は button にすると入れ子になる。
 * キーボードからは ListBox や入力欄で選択を外せるため、既定は span + role='button' にする。
 * トリガーの外(DateField.Suffix など)に置く場合は elementType='button' で本物の button にする。
 */
export const TriggerClearButton: FC<{
  onClear: () => void
  elementType?: 'span' | 'button'
  className?: string
  'aria-label'?: string
}> = ({ onClear, elementType = 'span', className, 'aria-label': ariaLabel }) => {
  const uiText = useGeneralUiText()
  const props = {
    'aria-label': ariaLabel ?? uiText.clear,
    className: cn('inline-flex cursor-pointer items-center opacity-60 hover:opacity-100', className),
    // トリガーの onClick は開閉なので、クリアでは伝播を止める
    onPointerDown: (e: PointerEvent) => e.stopPropagation(),
    onClick: (e: MouseEvent) => {
      e.stopPropagation()
      onClear()
    },
    children: <XCircleIcon width={16} />,
  }
  return elementType === 'button' ? (
    <button type='button' {...props} />
  ) : (
    <span role='button' tabIndex={-1} {...props} />
  )
}
