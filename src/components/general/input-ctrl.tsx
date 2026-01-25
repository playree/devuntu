'use client'

import { Input, InputProps } from '@heroui/react'
import { ChangeEvent } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'

export const InputCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  type = 'text',
  variant = 'faded',
  onChanged,
  ...props
}: InputProps & {
  control?: Control<TFieldValues>
  name: TName
  onChanged?: (e: ChangeEvent<HTMLInputElement>) => void
}) => {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value } }) => (
        <Input
          {...props}
          type={type}
          variant={variant}
          onChange={
            type === 'number'
              ? (event) => {
                  if (onChanged) {
                    onChanged(event)
                  }
                  onChange(Number(event.target.value))
                }
              : (event) => {
                  if (onChanged) {
                    onChanged(event)
                  }
                  onChange(event)
                }
          }
          value={value || (type === 'number' ? '0' : '')}
          isInvalid={!!props.errorMessage}
        />
      )}
    />
  )
}
