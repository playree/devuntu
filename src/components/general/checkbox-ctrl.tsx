'use client'

import { Checkbox, CheckboxProps, Label } from '@heroui/react'
import { FC } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'

export const CheckBoxItem: FC<CheckboxProps & { id: string; label: string }> = ({ id, label, ...props }) => {
  return (
    <Checkbox {...props} id={id}>
      <Checkbox.Control className='size-5'>
        <Checkbox.Indicator />
      </Checkbox.Control>
      <Checkbox.Content>
        <Label htmlFor={id}>{label}</Label>
      </Checkbox.Content>
    </Checkbox>
  )
}

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
        <CheckBoxItem {...props} isSelected={value} onChange={onChange} onBlur={onBlur} ref={ref} id={id} />
      )}
    />
  )
}
