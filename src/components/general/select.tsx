'use client'

import { Chip, cn, ErrorMessage, Label, ListBox, Select } from '@heroui/react'
import { FC, ReactNode, Ref, SVGProps } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'
import { useIsSmart } from './smart'

export const XCircleIcon: FC<SVGProps<SVGSVGElement>> = ({ width = 20, strokeWidth = 2, ...props }) => (
  <svg
    fill='currentColor'
    viewBox='0 0 24 24'
    xmlns='http://www.w3.org/2000/svg'
    aria-hidden='true'
    width={width}
    strokeWidth={strokeWidth}
    {...props}
  >
    <path
      clipRule='evenodd'
      fillRule='evenodd'
      d='M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm-1.72 6.97a.75.75 0 1 0-1.06 1.06L10.94 12l-1.72 1.72a.75.75 0 1 0 1.06 1.06L12 13.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L13.06 12l1.72-1.72a.75.75 0 1 0-1.06-1.06L12 10.94l-1.72-1.72Z'
    />
  </svg>
)

type SelectFieldBaseProps = {
  groupOptions: Record<string, string>
  label: string
  /** ラベルを読み上げ用にだけ残す(見出しを呼び出し側で出す場合) */
  isLabelHidden?: boolean
  /**
   * ラベルに必須(*)を出す。
   * Select 本体には渡さない。react-aria が form 内に <select required> を出し、
   * 未選択のまま submit すると react-hook-form まで届かず無反応になるため。
   * validationBehavior='aria' にしてもトリガー(button)に aria-required は付かないので、
   * 読み上げ向けの必須はラベル表記に任せる
   */
  isRequired?: boolean
  variant?: 'primary' | 'secondary'
  isSmart?: boolean
  errorMessage?: string
  onBlur?: () => void
  ref?: Ref<HTMLDivElement>
}

type MultiSelectFieldProps = SelectFieldBaseProps & {
  value: string[]
  onChange: (value: string[]) => void
  /** 未選択時の表示。共通部品なのでロケールが要る場合は呼び出し側から渡す */
  placeholder?: ReactNode
}

/**
 * react-hook-form に依存しない複数選択 Select 本体。
 * 値は選択肢の ID(string) の配列。value / onChange / onBlur / ref を渡して外部stateで制御する。
 */
export const MultiSelectField = ({
  groupOptions,
  label,
  isRequired,
  variant,
  isSmart: isSmartProp,
  errorMessage,
  value,
  onChange,
  onBlur,
  placeholder,
  ref,
}: MultiSelectFieldProps) => {
  const isSmart = useIsSmart(isSmartProp)
  return (
    <div className='space-y-4'>
      <Select
        selectionMode='multiple'
        value={value}
        variant={variant}
        onChange={(keys) => onChange(keys.map(String))}
        onBlur={onBlur}
        ref={ref}
      >
        <Label className={isSmart ? 'text-xs font-light' : ''} isRequired={isRequired}>
          {label}
        </Label>
        <Select.Trigger className={isSmart ? 'min-h-7 py-1' : undefined}>
          <Select.Value>
            {() => {
              return value.length > 0 ? (
                value.map((id: string) => (
                  <Chip key={id} variant='soft' color='accent'>
                    {groupOptions[id]}
                  </Chip>
                ))
              ) : (
                // 既定値は共通部品なのでローカライズ不要とする(必要なら placeholder で差し替える)
                <Chip variant='tertiary'>{placeholder ?? 'Not selected'}</Chip>
              )
            }}
          </Select.Value>
          {value.length > 0 && (
            <span
              /**
               * Select.Trigger は内部が button なので、ここを button にすると入れ子になる。
               * キーボードからは ListBox で選択を外せるため span + role='button' のままにする
               */
              role='button'
              // 共通部品なのでローカライズ不要とする
              aria-label='clear'
              tabIndex={-1}
              className='ml-auto inline-flex cursor-pointer items-center opacity-60 hover:opacity-100'
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onChange([])
              }}
            >
              <XCircleIcon width={16} />
            </span>
          )}
          <Select.Indicator />
        </Select.Trigger>
        <ErrorMessage className={isSmart ? '' : 'min-h-4'}>{errorMessage}</ErrorMessage>
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
  isDisabled?: boolean
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
  triggerLabel,
  value,
  onChange,
  onBlur,
  ref,
}: SingleSelectFieldProps) => {
  const isSmart = useIsSmart(isSmartProp)
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
        <Label
          className={cn(isSmart ? 'text-xs font-light' : '', isLabelHidden ? 'sr-only' : '')}
          isRequired={isRequired}
        >
          {label}
        </Label>
        <Select.Trigger // isSmart: 既定 36px を 28px に詰める
          className={isSmart ? 'min-h-7 py-1' : undefined}
        >
          <Select.Value>
            {() => {
              if (triggerLabel) {
                return <>{triggerLabel}</>
              }
              return value && groupOptions[value] ? <>{groupOptions[value]}</> : <></>
            }}
          </Select.Value>
          {isClearable && value && (
            <span
              /**
               * Select.Trigger は内部が button なので、ここを button にすると入れ子になる。
               * キーボードからは ListBox で選択を外せるため span + role='button' のままにする
               */
              role='button'
              // 共通部品なのでローカライズ不要とする
              aria-label='clear'
              tabIndex={-1}
              className='ml-auto inline-flex cursor-pointer items-center opacity-60 hover:opacity-100'
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onChange(null)
              }}
            >
              <XCircleIcon width={16} />
            </span>
          )}
          <Select.Indicator />
        </Select.Trigger>
        <ErrorMessage className={isSmart ? '' : 'min-h-4'}>{errorMessage}</ErrorMessage>
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
 */
export const SingleSelectCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  ...props
}: Omit<SingleSelectFieldProps, 'value' | 'onChange' | 'onBlur' | 'ref'> & {
  control: Control<TFieldValues>
  name: TName
}) => {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value, onBlur, ref } }) => (
        <SingleSelectField {...props} value={value ?? null} onChange={onChange} onBlur={onBlur} ref={ref} />
      )}
    />
  )
}
