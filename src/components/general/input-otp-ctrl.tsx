'use client'

import { InputOTP, InputOTPProps } from '@heroui/react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'

export const InputOtpCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  onChanged,
  ...props
}: Omit<InputOTPProps, 'children'> & {
  control?: Control<TFieldValues>
  name: TName
  onChanged?: (value: string) => void
}) => {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value } }) => (
        <InputOTP
          {...props}
          onChange={(value) => {
            if (onChanged) {
              onChanged(value)
            }
            onChange(value)
          }}
          value={value}
        >
          <InputOTP.Group>
            <InputOTP.Slot index={0} />
            <InputOTP.Slot index={1} />
            <InputOTP.Slot index={2} />
            <InputOTP.Slot index={3} />
            <InputOTP.Slot index={4} />
            <InputOTP.Slot index={5} />
          </InputOTP.Group>
        </InputOTP>
      )}
    />
  )
}
