'use client'

import { cn, Input, InputProps, SearchField, SearchFieldProps, TextField } from '@heroui/react'
import { ChangeEvent } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'
import { z } from 'zod'
import { MultiButton } from './button'
import { FieldBaseProps, FieldError, FieldLabel } from './field'
import { getFieldConstraints } from './field-constraints'
import { MagnifyingGlassIcon } from './icons'
import { useIsSmart, useSmart } from './smart'
import { useGeneralUiText } from './ui-text'

type InputFieldProps = InputProps & FieldBaseProps & { className?: string }

/**
 * react-hook-form に依存しない Input 本体。
 * ラベル / 必須(*) / エラーメッセージ / isSmart(コンパクト表示) の描画のみを担当する。
 * value / onChange / onBlur / ref はそのまま Input へ透過するため、外部stateでも制御できる。
 */
export const InputField = ({
  type = 'text',
  label,
  isLabelHidden,
  isRequired,
  isDisabled,
  isReadOnly,
  errorMessage,
  isSmart: isSmartProp,
  isSmartForm: isSmartFormProp,
  className,
  ...props
}: InputFieldProps) => {
  const { isCompact, hasErrorArea } = useSmart(isSmartProp, isSmartFormProp)
  return (
    <TextField
      isInvalid={!!errorMessage}
      isDisabled={isDisabled}
      isReadOnly={isReadOnly}
      isRequired={isRequired}
      /**
       * 既定の native はネイティブ制約検証を有効にするため、未入力だと submit イベントごと
       * 握り潰されて react-hook-form の handleSubmit まで届かない。
       * aria なら required の代わりに aria-required が付き、検証は zod の一本に保てる
       */
      validationBehavior='aria'
    >
      <FieldLabel isCompact={isCompact} isHidden={isLabelHidden} isRequired={isRequired}>
        {label}
      </FieldLabel>
      <Input
        {...props}
        // isCompact: 既定 36px を 28px に詰める
        className={cn(isCompact ? 'py-1' : '', className)}
        type={type}
      />
      <FieldError hasErrorArea={hasErrorArea}>{errorMessage}</FieldError>
    </TextField>
  )
}

/**
 * react-hook-form 対応の Input。描画は InputField に委譲する。
 * `constraintSchema` を渡すと minLength / maxLength / min / max / 必須(*) をスキーマから自動反映する。
 */
export const InputCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  constraintSchema,
  type = 'text',
  onChanged,
  isRequired,
  ...props
}: InputFieldProps & {
  control: Control<TFieldValues>
  name: TName
  constraintSchema?: z.ZodObject
  onChanged?: (e: ChangeEvent<HTMLInputElement>) => void
}) => {
  const { isRequired: schemaRequired, ...constraints } = constraintSchema
    ? getFieldConstraints(constraintSchema, name)
    : {}
  const requiredFlag = isRequired ?? schemaRequired
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value, onBlur, ref } }) => (
        <InputField
          {...constraints}
          {...props}
          type={type}
          isRequired={requiredFlag}
          onChange={(event) => {
            if (onChanged) {
              onChanged(event)
            }
            if (type === 'number') {
              onChange(Number(event.target.value))
            } else {
              onChange(event)
            }
          }}
          value={value || (type === 'number' ? '0' : '')}
          onBlur={onBlur}
          ref={ref}
        />
      )}
    />
  )
}

/**
 * 検索用の Input。`onSubmit` を渡すと枠内の右端に検索ボタンを表示する。
 * `onSubmit` は HeroUI(react-aria) 側へ渡さず自前で発火させている。
 * 内部実装は Enter を無条件に submit 扱いするため、IME 変換確定の Enter で誤検索されるのを避ける狙い。
 */
export const InputSearchField = ({
  label,
  isRequired,
  isSmart: isSmartProp,
  className,
  placeholder,
  maxLength,
  onSubmit,
  searchLabel,
  ...props
}: SearchFieldProps & {
  label?: string
  isRequired?: boolean
  isSmart?: boolean
  placeholder?: string
  maxLength?: number
  /** 検索ボタンの aria-label / tooltip。未指定なら GeneralUiText の search */
  searchLabel?: string
}) => {
  const isSmart = useIsSmart(isSmartProp)
  const uiText = useGeneralUiText()
  const searchButtonLabel = searchLabel ?? uiText.search
  return (
    <SearchField
      {...props}
      isRequired={isRequired}
      // validationBehavior の事情は InputField と同じ
      validationBehavior='aria'
    >
      {({ state }) => (
        <>
          <FieldLabel isCompact={isSmart} isRequired={isRequired}>
            {label}
          </FieldLabel>
          <SearchField.Group className={isSmart ? 'h-min' : ''}>
            <SearchField.SearchIcon />
            <SearchField.Input
              className={cn(isSmart ? 'py-1' : '', className)}
              placeholder={placeholder ?? uiText.search}
              maxLength={maxLength}
              // 変換確定の Enter は検索として扱わない
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  if (onSubmit) {
                    onSubmit(state.value)
                  }
                }
              }}
            />
            <SearchField.ClearButton />
            {onSubmit && (
              <MultiButton
                // SearchField は ButtonContext に clear ボタンの props を流すため slot={null} で継承を切る
                // (付けないと押下で入力がクリアされ、Tab でも到達できない)
                slot={null}
                isIconOnly
                size='sm'
                variant='ghost'
                className='mr-1 shrink-0'
                aria-label={searchButtonLabel}
                tooltip={searchButtonLabel}
                icon={<MagnifyingGlassIcon />}
                onPress={() => onSubmit(state.value)}
              />
            )}
          </SearchField.Group>
        </>
      )}
    </SearchField>
  )
}
