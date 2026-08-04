'use client'

import { Switch, SwitchProps } from '@heroui/react'
import { FC } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'

/**
 * react-hook-form に依存しない Switch 本体。
 * isSelected / onChange / onBlur / ref はそのまま Switch へ透過するため、外部stateでも制御できる。
 */
export const SwitchField: FC<SwitchProps & { id: string; label: string }> = ({ id, label, ...props }) => {
  return (
    <Switch {...props} id={id}>
      <Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        {label}
      </Switch.Content>
    </Switch>
  )
}

/**
 * react-hook-form 対応の Switch。描画は SwitchField に委譲する。
 */
export const SwitchCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  id,
  name,
  ...props
}: SwitchProps & {
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
        <SwitchField {...props} isSelected={value} onChange={onChange} onBlur={onBlur} ref={ref} id={id} />
      )}
    />
  )
}
