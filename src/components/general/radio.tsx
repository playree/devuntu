'use client'

import { cn, Radio, RadioGroup, RadioGroupProps } from '@heroui/react'
import { FC } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'
import { FieldBaseProps, FieldError, FieldLabel } from './field'
import { useSmart } from './smart'

export type RadioOption = { value: string; label: string }

type RadioFieldProps = Omit<RadioGroupProps, 'children' | 'onChange'> &
  FieldBaseProps & {
    label: string
    options: RadioOption[]
    onChange?: (value: string) => void
  }

/**
 * react-hook-form に依存しない RadioGroup 本体。
 * ラベル / エラーメッセージ / isSmart の描画だけを担当し、value / onChange は透過する。
 *
 * 選択肢が2〜4個で全部を並べて見せたいときに使う。それ以上は `SingleSelectField` の方が収まる。
 */
export const RadioField: FC<RadioFieldProps> = ({
  label,
  isLabelHidden,
  options,
  errorMessage,
  isRequired,
  isSmart,
  isSmartForm,
  className,
  onChange,
  ...props
}) => {
  const { isCompact, hasErrorArea } = useSmart(isSmart, isSmartForm)

  return (
    <RadioGroup
      {...props}
      isInvalid={!!errorMessage}
      isRequired={isRequired}
      // 既定では子に mt-4 が入るため、gap で詰められるよう打ち消す
      className={cn('gap-2 **:data-[slot=radio]:mt-0', className)}
      onChange={onChange}
    >
      <FieldLabel isCompact={isCompact} isHidden={isLabelHidden} isRequired={isRequired}>
        {label}
      </FieldLabel>
      {options.map((option) => (
        <Radio key={option.value} value={option.value}>
          <Radio.Content className={isCompact ? 'gap-2 text-sm font-normal' : ''}>
            <Radio.Control className={cn('size-5', isCompact ? 'size-4' : '')}>
              <Radio.Indicator />
            </Radio.Control>
            {option.label}
          </Radio.Content>
        </Radio>
      ))}
      <FieldError hasErrorArea={hasErrorArea}>{errorMessage}</FieldError>
    </RadioGroup>
  )
}

/**
 * react-hook-form 対応の RadioGroup。描画は RadioField に委譲する。
 */
export const RadioCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  ...props
}: Omit<RadioFieldProps, 'value'> & {
  control: Control<TFieldValues>
  name: TName
}) => (
  <Controller
    control={control}
    name={name}
    render={({ field: { onChange, value, onBlur, ref } }) => (
      <RadioField {...props} value={value ?? ''} onChange={onChange} onBlur={onBlur} ref={ref} />
    )}
  />
)
