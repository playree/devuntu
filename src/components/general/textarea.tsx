'use client'

import { getFieldConstraints } from '@/lib/schema-util'
import { cn, ErrorMessage, Label, TextArea, TextAreaProps, TextField } from '@heroui/react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'
import { z } from 'zod'
import { useSmart } from './smart'

type TextAreaFieldProps = TextAreaProps & {
  label?: string
  isRequired?: boolean
  isReadOnly?: boolean
  errorMessage?: string
  isSmart?: boolean
  isSmartForm?: boolean
  className?: string
}

/**
 * react-hook-form に依存しない TextArea 本体。
 * ラベル / 必須(*) / エラーメッセージの描画のみを担当する。
 * value / onChange / onBlur / ref はそのまま TextArea へ透過するため、外部stateでも制御できる。
 */
export const TextAreaField = ({
  label,
  isRequired,
  isReadOnly,
  errorMessage,
  rows = 6,
  isSmart: isSmartProp,
  isSmartForm: isSmartFormProp,
  className,
  ...props
}: TextAreaFieldProps) => {
  const { isCompact, hasErrorArea } = useSmart(isSmartProp, isSmartFormProp)
  return (
    <TextField
      isInvalid={!!errorMessage}
      isReadOnly={isReadOnly}
      isRequired={isRequired}
      /**
       * 既定の native はネイティブ制約検証を有効にするため、未入力だと submit イベントごと
       * 握り潰されて react-hook-form の handleSubmit まで届かない。
       * aria なら required の代わりに aria-required が付き、検証は zod の一本に保てる
       */
      validationBehavior='aria'
    >
      {label && (
        <Label className={isCompact ? 'text-xs font-light' : ''} isRequired={isRequired}>
          {label}
        </Label>
      )}
      <TextArea fullWidth rows={rows} {...props} className={cn(isCompact ? 'py-1' : '', className)} />
      <ErrorMessage className={hasErrorArea ? 'min-h-4' : ''}>{errorMessage}</ErrorMessage>
    </TextField>
  )
}

/**
 * react-hook-form 対応の TextArea。描画は TextAreaField に委譲する。
 * `constraintSchema` を渡すと minLength / maxLength / 必須(*) をスキーマから自動反映する(InputCtrl と同じ方針)。
 */
export const TextAreaCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  constraintSchema,
  isRequired,
  ...props
}: TextAreaFieldProps & {
  control: Control<TFieldValues>
  name: TName
  constraintSchema?: z.ZodObject
}) => {
  /**
   * getFieldConstraints は min / max も返すが TextArea は受け取れないため、
   * InputCtrl のような一括スプレッドはせず必要な3つだけ取り出す
   */
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
        <TextAreaField
          minLength={minLength}
          maxLength={maxLength}
          {...props}
          isRequired={requiredFlag}
          value={value ?? ''}
          onChange={onChange}
          onBlur={onBlur}
          ref={ref}
        />
      )}
    />
  )
}
