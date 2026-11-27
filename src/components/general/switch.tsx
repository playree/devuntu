'use client'

import { Switch, SwitchProps } from '@heroui/react'
import { FC, ReactNode } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'
import { HelpTip } from './help-tip'
import { useIsSmart } from './smart'

type SwitchFieldProps = SwitchProps & { id: string; label: string; help?: ReactNode; isSmart?: boolean }

/** react-hook-form に依存しない Switch 本体 */
export const SwitchField: FC<SwitchFieldProps> = ({ id, label, help, isSmart: isSmartProp, size, ...props }) => {
  const isSmart = useIsSmart(isSmartProp)
  const field = (
    <Switch // Switchはvariantを持たずsizeで大きさを変えるため、isSmartはclassNameではなくsizeへ反映する
      {...props}
      size={size ?? (isSmart ? 'md' : 'lg')}
      id={id}
    >
      <Switch.Content className={isSmart ? 'gap-2 text-sm font-normal' : 'text-md font-normal'}>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        {label}
      </Switch.Content>
    </Switch>
  )
  if (!help) {
    return field
  }
  return (
    <div className='flex items-center gap-1'>
      {field}
      <HelpTip label={label}>{help}</HelpTip>
    </div>
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
}: SwitchFieldProps & {
  control: Control<TFieldValues>
  name: TName
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
