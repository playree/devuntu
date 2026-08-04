'use client'

import { Checkbox, CheckboxProps } from '@heroui/react'
import { FC } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'

/**
 * react-hook-form に依存しない Checkbox 本体。
 * isSelected / onChange / onBlur / ref はそのまま Checkbox へ透過するため、外部stateでも制御できる。
 */
export const CheckBoxField: FC<CheckboxProps & { id: string; label: string }> = ({ id, label, ...props }) => {
  return (
    <Checkbox {...props} id={id}>
      <Checkbox.Content>
        <Checkbox.Control className='size-5'>
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
