'use client'

import { Checkbox, CheckboxGroup, CheckboxProps, cn } from '@heroui/react'
import { FC, ReactNode, useId } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'
import { FieldBaseProps, FieldError, FieldLabel } from './field'
import { useIsSmart, useSmart } from './smart'

/**
 * react-hook-form に依存しない Checkbox 本体。
 * isSelected / onChange / onBlur / ref はそのまま Checkbox へ透過するため、外部stateでも制御できる。
 */
export const CheckboxField: FC<CheckboxProps & { id: string; label: string; isSmart?: boolean }> = ({
  id,
  label,
  isSmart: isSmartProp,
  ...props
}) => {
  const isSmart = useIsSmart(isSmartProp)
  return (
    <Checkbox {...props} id={id}>
      <Checkbox.Content // isSmart: ラベル相当の文言なので他フィールドのラベルと同じ体裁に揃える
        className={isSmart ? 'gap-2 text-sm font-normal' : ''}
      >
        <Checkbox.Control className={cn('size-5', isSmart ? 'size-4' : '')}>
          <Checkbox.Indicator />
        </Checkbox.Control>
        {label}
      </Checkbox.Content>
    </Checkbox>
  )
}

/**
 * react-hook-form 対応の Checkbox。描画は CheckboxField に委譲する。
 */
export const CheckboxCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  id,
  name,
  ...props
}: CheckboxProps & {
  control: Control<TFieldValues>
  name: TName
  id: string
  label: string
  isSmart?: boolean
}) => {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value, onBlur, ref } }) => (
        <CheckboxField {...props} isSelected={value} onChange={onChange} onBlur={onBlur} ref={ref} id={id} />
      )}
    />
  )
}

export type CheckboxOption<T extends string = string> = { value: T; label: string }

/**
 * react-hook-form に依存しない複数選択のチェックボックス群。
 * 値は選択肢の value の配列で、並びは選んだ順ではなく options の順に揃える。
 */
export const CheckboxGroupField = <T extends string>({
  label,
  isLabelHidden,
  isRequired,
  isDisabled,
  isReadOnly,
  errorMessage,
  isSmart: isSmartProp,
  isSmartForm: isSmartFormProp,
  options,
  value,
  onChange,
  orientation = 'vertical',
  labelAction,
  className,
}: FieldBaseProps & {
  label: string
  options: readonly CheckboxOption<T>[]
  value: readonly T[]
  onChange: (value: T[]) => void
  orientation?: 'vertical' | 'horizontal'
  /** ラベルの横に並べる操作(一括選択のボタンなど) */
  labelAction?: ReactNode
  className?: string
}) => {
  const { isCompact, hasErrorArea } = useSmart(isSmartProp, isSmartFormProp)
  const idPrefix = useId()
  const fieldLabel = (
    <FieldLabel isCompact={isCompact} isHidden={isLabelHidden} isRequired={isRequired}>
      {label}
    </FieldLabel>
  )

  return (
    <CheckboxGroup
      className={cn('gap-2', className)}
      isInvalid={!!errorMessage}
      isDisabled={isDisabled}
      isReadOnly={isReadOnly}
      // isRequired は渡さない(ネイティブ required 検証で submit が握り潰されるため)。必須はラベルの表記で伝える
      value={[...value]}
      onChange={(keys) =>
        onChange(options.filter((option) => keys.includes(option.value)).map((option) => option.value))
      }
    >
      {labelAction ? (
        <div className='flex items-center gap-2'>
          {fieldLabel}
          {labelAction}
        </div>
      ) : (
        fieldLabel
      )}
      <div // checkbox-group の既定は子に mt-4 が入るため、gap で詰められるよう打ち消す
        className={cn(
          '**:data-[slot=checkbox]:mt-0',
          orientation === 'horizontal' ? 'flex flex-wrap gap-3' : 'flex flex-col gap-2',
        )}
      >
        {options.map((option) => (
          <CheckboxField
            key={option.value}
            id={`${idPrefix}-${option.value}`}
            value={option.value}
            label={option.label}
            isSmart={isCompact}
          />
        ))}
      </div>
      <FieldError hasErrorArea={hasErrorArea}>{errorMessage}</FieldError>
    </CheckboxGroup>
  )
}
