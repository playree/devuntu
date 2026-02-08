'use client'

import { InputOtp, InputOtpProps } from '@heroui/react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'

export const InputOtpCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  length,
  variant = 'faded',
  onChanged,
  ...props
}: InputOtpProps & {
  control?: Control<TFieldValues>
  name: TName
  onChanged?: (value: string) => void
}) => {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value } }) => (
        <InputOtp
          {...props}
          length={length}
          variant={variant}
          onValueChange={(value) => {
            if (onChanged) {
              onChanged(value)
            }
            onChange(value)
          }}
          value={value}
          isInvalid={!!props.errorMessage}
        />
      )}
    />
  )
}
