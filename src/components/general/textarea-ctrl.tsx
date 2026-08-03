'use client'

import { getFieldConstraints } from '@/lib/schema-util'
import { ErrorMessage, Label, TextArea, TextAreaProps, TextField } from '@heroui/react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'
import { z } from 'zod'

/**
 * react-hook-form 対応の TextArea。
 * `constraintSchema` を渡すと maxLength / 必須(*) をスキーマから自動反映する(InputCtrl と同じ方針)。
 */
export const TextAreaCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  constraintSchema,
  label,
  isRequired,
  isReadOnly,
  errorMessage,
  rows = 6,
  ...props
}: TextAreaProps & {
  control: Control<TFieldValues>
  name: TName
  constraintSchema?: z.ZodObject
  label?: string
  isRequired?: boolean
  isReadOnly?: boolean
  errorMessage?: string
}) => {
  const {
    isRequired: schemaRequired,
    minLength,
    maxLength,
  } = constraintSchema ? getFieldConstraints(constraintSchema, name) : {}
  const requiredFlag = isRequired ?? schemaRequired

  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value, onBlur, ref } }) => (
        <TextField isInvalid={!!errorMessage} isReadOnly={isReadOnly} isRequired={requiredFlag}>
          {label && (
            <Label>
              {label}
              {requiredFlag ? '*' : ''}
            </Label>
          )}
          <TextArea
            fullWidth
            minLength={minLength}
            maxLength={maxLength}
            rows={rows}
            {...props}
            value={value ?? ''}
            onChange={onChange}
            onBlur={onBlur}
            ref={ref}
          />
          <ErrorMessage className='min-h-4'>{errorMessage}</ErrorMessage>
        </TextField>
      )}
    />
  )
}
