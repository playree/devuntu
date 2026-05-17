'use client'

import { ErrorMessage, Input, InputProps, Label, TextField } from '@heroui/react'
import { ChangeEvent } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'

export const InputCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  type = 'text',
  onChanged,
  label,
  isRequired,
  isReadOnly,
  errorMessage,
  ...props
}: InputProps & {
  control: Control<TFieldValues>
  name: TName
  onChanged?: (e: ChangeEvent<HTMLInputElement>) => void
  label?: string
  isRequired?: boolean
  isReadOnly?: boolean
  errorMessage?: string
}) => {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value, onBlur, ref } }) => (
        <TextField isInvalid={!!errorMessage} isReadOnly={isReadOnly}>
          <Label>
            {label}
            {isRequired ? '*' : ''}
          </Label>
          <Input
            {...props}
            type={type}
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
            onBlur={onBlur}
            ref={ref}
          />
          <ErrorMessage className='min-h-4'>{errorMessage}</ErrorMessage>
        </TextField>
      )}
    />
  )
}
