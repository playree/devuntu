'use client'

import { InputOTP, InputOTPProps } from '@heroui/react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'

type InputOtpFieldProps = Omit<InputOTPProps, 'children'>

/**
 * react-hook-form に依存しない InputOTP(6桁)本体。
 * value / onChange / onBlur / ref はそのまま InputOTP へ透過するため、外部stateでも制御できる。
 */
export const InputOtpField = (props: InputOtpFieldProps) => {
  return (
    <InputOTP {...props}>
      <InputOTP.Group className='mx-auto'>
        <InputOTP.Slot index={0} />
        <InputOTP.Slot index={1} />
        <InputOTP.Slot index={2} />
        <InputOTP.Slot index={3} />
        <InputOTP.Slot index={4} />
        <InputOTP.Slot index={5} />
      </InputOTP.Group>
    </InputOTP>
  )
}

/**
 * react-hook-form 対応の InputOTP。描画は InputOtpField に委譲する。
 */
export const InputOtpCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  onChanged,
  ...props
}: InputOtpFieldProps & {
  control: Control<TFieldValues>
  name: TName
  onChanged?: (value: string) => void
}) => {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value, onBlur, ref } }) => (
        <InputOtpField
          {...props}
          onChange={(value) => {
            if (onChanged) {
              onChanged(value)
            }
            onChange(value)
          }}
          value={value}
          onBlur={onBlur}
          ref={ref}
        />
      )}
    />
  )
}
