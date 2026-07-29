'use client'

import { getFieldConstraints } from '@/lib/schema-util'
import { cn, ErrorMessage, Input, InputProps, Label, TextField } from '@heroui/react'
import { ChangeEvent } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'
import { z } from 'zod'
import { useIsSmart } from './smart'

export const InputCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  constraintSchema,
  type = 'text',
  onChanged,
  label,
  isRequired,
  isReadOnly,
  errorMessage,
  isSmart: isSmartProp,
  className,
  ...props
}: InputProps & {
  control: Control<TFieldValues>
  name: TName
  constraintSchema?: z.ZodObject
  onChanged?: (e: ChangeEvent<HTMLInputElement>) => void
  label?: string
  isRequired?: boolean
  isReadOnly?: boolean
  errorMessage?: string
  isSmart?: boolean
  className?: string
}) => {
  const isSmart = useIsSmart(isSmartProp)
  const { isRequired: schemaRequired, ...constraints } = constraintSchema
    ? getFieldConstraints(constraintSchema, name)
    : {}
  const requiredFlag = isRequired ?? schemaRequired
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value, onBlur, ref } }) => (
        <TextField isInvalid={!!errorMessage} isReadOnly={isReadOnly}>
          <Label className={isSmart ? 'text-xs font-light' : ''}>
            {label}
            {requiredFlag ? '*' : ''}
          </Label>
          <Input
            {...constraints}
            {...props}
            // isSmart: 既定 36px(py-2)を 28px へ。text-sm の行高 20px + 上下 4px
            className={cn(isSmart ? 'py-1' : '', className)}
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
          <ErrorMessage className={isSmart ? '' : 'min-h-4'}>{errorMessage}</ErrorMessage>
        </TextField>
      )}
    />
  )
}
