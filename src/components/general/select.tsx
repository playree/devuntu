'use client'

import { Chip, ListBox, Select } from '@heroui/react'
import { ReactNode, Ref } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'
import { FieldBaseProps, FieldError, FieldLabel, TriggerClearButton } from './field'
import { useSmart } from './smart'
import { useGeneralUiText } from './ui-text'

/** Select は読み取り専用を持たないので isReadOnly は受け取らない */
type SelectFieldBaseProps = Omit<FieldBaseProps, 'isReadOnly'> & {
  groupOptions: Record<string, string>
  label: string
  /**
   * ラベルに必須(*)を出す。
   * Select 本体には渡さない。react-aria が form 内に <select required> を出し、
   * 未選択のまま submit すると react-hook-form まで届かず無反応になるため。
   * validationBehavior='aria' にしてもトリガー(button)に aria-required は付かないので、
   * 読み上げ向けの必須はラベル表記に任せる
   */
  isRequired?: boolean
  variant?: 'primary' | 'secondary'
  onBlur?: () => void
  ref?: Ref<HTMLDivElement>
}

type MultiSelectFieldProps = SelectFieldBaseProps & {
  value: string[]
  onChange: (value: string[]) => void
  /** 未選択時の表示。未指定なら GeneralUiText の notSelected */
  placeholder?: ReactNode
}

/**
 * react-hook-form に依存しない複数選択 Select 本体。
 * 値は選択肢の ID(string) の配列。value / onChange / onBlur / ref を渡して外部stateで制御する。
 */
export const MultiSelectField = ({
  groupOptions,
  label,
  isLabelHidden,
  isRequired,
  isDisabled,
  variant,
  isSmart: isSmartProp,
  isSmartForm: isSmartFormProp,
  errorMessage,
  value,
  onChange,
  onBlur,
  placeholder,
  ref,
}: MultiSelectFieldProps) => {
  const { isCompact, hasErrorArea } = useSmart(isSmartProp, isSmartFormProp)
  const uiText = useGeneralUiText()
  return (
    <div className='space-y-4'>
      <Select
        selectionMode='multiple'
        value={value}
        variant={variant}
        isDisabled={isDisabled}
        onChange={(keys) => onChange(keys.map(String))}
        onBlur={onBlur}
        ref={ref}
      >
        <FieldLabel isCompact={isCompact} isHidden={isLabelHidden} isRequired={isRequired}>
          {label}
        </FieldLabel>
        <Select.Trigger className={isCompact ? 'min-h-7 py-1' : undefined}>
          <Select.Value>
            {() => {
              return value.length > 0 ? (
                value.map((id: string) => (
                  <Chip key={id} variant='soft' color='accent'>
                    {groupOptions[id]}
                  </Chip>
                ))
              ) : (
                <Chip variant='tertiary'>{placeholder ?? uiText.notSelected}</Chip>
              )
            }}
          </Select.Value>
          {value.length > 0 && !isDisabled && <TriggerClearButton className='ml-auto' onClear={() => onChange([])} />}
          <Select.Indicator />
        </Select.Trigger>
        <FieldError hasErrorArea={hasErrorArea}>{errorMessage}</FieldError>
        <Select.Popover>
          <ListBox selectionMode='multiple'>
            {Object.entries(groupOptions).map(([id, name]) => (
              <ListBox.Item key={id} id={id} textValue={name} className='min-h-min py-1'>
                {name}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    </div>
  )
}

/**
 * react-hook-form 対応の複数選択 Select。描画は MultiSelectField に委譲する。
 */
export const MultiSelectCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  ...props
}: Omit<MultiSelectFieldProps, 'value' | 'onChange' | 'onBlur' | 'ref'> & {
  control: Control<TFieldValues>
  name: TName
}) => {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value, onBlur, ref } }) => (
        <MultiSelectField {...props} value={value ?? []} onChange={onChange} onBlur={onBlur} ref={ref} />
      )}
    />
  )
}

export type SingleSelectFieldProps = SelectFieldBaseProps & {
  value: string | null
  onChange: (value: string | null) => void
  isClearable?: boolean
  /**
   * トリガーに現在値ではなく固定の表示を出す。
   * 値が別の手段(かんばんのレーンなど)で既に自明で、トリガーは操作の入口としてだけ使う場合に指定する。
   */
  triggerLabel?: ReactNode
}

/**
 * react-hook-form に依存しない単一選択 Select 本体。
 * 値は選択肢の ID(string) または null。
 * `isClearable` を付けると未選択(null)へ戻せる(任意入力の項目向け)。
 * `isDisabled` は値を固定して表示だけしたい場合に使う。
 */
export const SingleSelectField = ({
  groupOptions,
  label,
  isLabelHidden,
  isRequired,
  variant,
  isClearable = false,
  isDisabled = false,
  errorMessage,
  isSmart: isSmartProp,
  isSmartForm: isSmartFormProp,
  triggerLabel,
  value,
  onChange,
  onBlur,
  ref,
}: SingleSelectFieldProps) => {
  const { isCompact, hasErrorArea } = useSmart(isSmartProp, isSmartFormProp)
  return (
    <div className='space-y-4'>
      <Select
        selectionMode='single'
        value={value}
        variant={variant}
        isDisabled={isDisabled}
        onChange={(key) => onChange(key === null ? null : key.toString())}
        onBlur={onBlur}
        ref={ref}
      >
        <FieldLabel isCompact={isCompact} isHidden={isLabelHidden} isRequired={isRequired}>
          {label}
        </FieldLabel>
        <Select.Trigger // isCompact: 既定 36px を 28px に詰める
          className={isCompact ? 'min-h-7 py-1' : undefined}
        >
          <Select.Value>
            {() => {
              if (triggerLabel) {
                return <>{triggerLabel}</>
              }
              return value && groupOptions[value] ? <>{groupOptions[value]}</> : <></>
            }}
          </Select.Value>
          {isClearable && value && !isDisabled && (
            <TriggerClearButton className='ml-auto' onClear={() => onChange(null)} />
          )}
          <Select.Indicator />
        </Select.Trigger>
        <FieldError hasErrorArea={hasErrorArea}>{errorMessage}</FieldError>
        <Select.Popover>
          <ListBox selectionMode='single'>
            {Object.entries(groupOptions).map(([id, name]) => (
              <ListBox.Item key={id} id={id} textValue={name} className='min-h-min py-1'>
                {name}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    </div>
  )
}

/**
 * react-hook-form 対応の単一選択 Select。描画は SingleSelectField に委譲する。
 * react-hook-form の値は選択肢の ID(string) または null。
 *
 * `emptyKey` は空値を選択肢として見せたい場合に指定する。react-aria の Select は空文字を
 * 未選択として扱いトリガーに何も出さないため、「なし」相当の選択肢には非空のキーが要る。
 * 指定時は空値を空文字で表すので、null へ戻す `isClearable` とは併用しない。
 */
export const SingleSelectCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  emptyKey,
  ...props
}: Omit<SingleSelectFieldProps, 'value' | 'onChange' | 'onBlur' | 'ref'> & {
  control: Control<TFieldValues>
  name: TName
  emptyKey?: string
}) => {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value, onBlur, ref } }) => (
        <SingleSelectField
          {...props}
          value={emptyKey && !value ? emptyKey : (value ?? null)}
          onChange={(key) => onChange(emptyKey && (key === null || key === emptyKey) ? '' : key)}
          onBlur={onBlur}
          ref={ref}
        />
      )}
    />
  )
}
