'use client'

import { getFieldConstraints } from '@/lib/schema-util'
import { cn, ErrorMessage, Input, InputProps, Label, SearchField, SearchFieldProps, TextField } from '@heroui/react'
import { ChangeEvent, FC, SVGProps } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'
import { z } from 'zod'
import { MultiButton } from './button'
import { useIsSmart } from './smart'

/** 検索実行ボタン用のアイコン(共通部品なのでこのフォルダ内で完結させる) */
const MagnifyingGlassIcon: FC<SVGProps<SVGSVGElement>> = ({ width = 16, strokeWidth = 2, ...props }) => (
  <svg
    fill='none'
    stroke='currentColor'
    viewBox='0 0 24 24'
    xmlns='http://www.w3.org/2000/svg'
    aria-hidden='true'
    width={width}
    strokeWidth={strokeWidth}
    {...props}
  >
    <path
      strokeLinecap='round'
      strokeLinejoin='round'
      d='m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z'
    />
  </svg>
)

type InputFieldProps = InputProps & {
  label?: string
  /** ラベルを読み上げ用にだけ残す(見出しを呼び出し側で出す場合) */
  isLabelHidden?: boolean
  isRequired?: boolean
  isReadOnly?: boolean
  errorMessage?: string
  isSmart?: boolean
  className?: string
}

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
  isReadOnly,
  errorMessage,
  isSmart: isSmartProp,
  className,
  ...props
}: InputFieldProps) => {
  const isSmart = useIsSmart(isSmartProp)
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
      <Label
        className={cn(isSmart ? 'text-xs font-light' : '', isLabelHidden ? 'sr-only' : '')}
        isRequired={isRequired}
      >
        {label}
      </Label>
      <Input
        {...props}
        // isSmart: 既定 36px を 28px に詰める
        className={cn(isSmart ? 'py-1' : '', className)}
        type={type}
      />
      <ErrorMessage className={isSmart ? '' : 'min-h-4'}>{errorMessage}</ErrorMessage>
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
  placeholder = 'Search...',
  maxLength,
  onSubmit,
  searchLabel = 'Search',
  ...props
}: SearchFieldProps & {
  label?: string
  isRequired?: boolean
  isSmart?: boolean
  placeholder?: string
  maxLength?: number
  /** 検索ボタンの aria-label / tooltip */
  searchLabel?: string
}) => {
  const isSmart = useIsSmart(isSmartProp)
  return (
    <SearchField
      {...props}
      isRequired={isRequired}
      // validationBehavior の事情は InputField と同じ
      validationBehavior='aria'
    >
      {({ state }) => (
        <>
          <Label className={isSmart ? 'text-xs font-light' : ''} isRequired={isRequired}>
            {label}
          </Label>
          <SearchField.Group className={isSmart ? 'h-min' : ''}>
            <SearchField.SearchIcon />
            <SearchField.Input
              className={cn(isSmart ? 'py-1' : '', className)}
              placeholder={placeholder}
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
                aria-label={searchLabel}
                tooltip={searchLabel}
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
