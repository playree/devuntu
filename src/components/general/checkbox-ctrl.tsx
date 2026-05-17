'use client'

import { Checkbox, CheckboxProps, Label } from '@heroui/react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'

export const CheckBoxCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  id,
  name,
  label,
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
        <Checkbox {...props} isSelected={value} onChange={onChange} onBlur={onBlur} ref={ref}>
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          <Checkbox.Content>
            <Label htmlFor={id}>{label}</Label>
          </Checkbox.Content>
        </Checkbox>
      )}
    />
  )
}
