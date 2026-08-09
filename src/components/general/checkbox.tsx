'use client'

import { Checkbox, CheckboxProps, cn } from '@heroui/react'
import { FC } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'
import { useIsSmart } from './smart'

/**
 * react-hook-form に依存しない Checkbox 本体。
 * isSelected / onChange / onBlur / ref はそのまま Checkbox へ透過するため、外部stateでも制御できる。
 */
export const CheckBoxField: FC<CheckboxProps & { id: string; label: string; isSmart?: boolean }> = ({
  id,
  label,
  isSmart: isSmartProp,
  ...props
}) => {
  const isSmart = useIsSmart(isSmartProp)
  return (
    <Checkbox {...props} id={id}>
      <Checkbox.Content // isSmart: ラベル相当の文言なので他フィールドのラベルと同じ体裁に揃える
        className={isSmart ? 'gap-2 text-xs font-light' : ''}
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
 * react-hook-form 対応の Checkbox。描画は CheckBoxField に委譲する。
 */
export const CheckBoxCtrl = <
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
        <CheckBoxField {...props} isSelected={value} onChange={onChange} onBlur={onBlur} ref={ref} id={id} />
      )}
    />
  )
}
